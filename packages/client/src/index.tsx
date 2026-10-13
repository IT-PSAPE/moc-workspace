import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { ReactNode } from "react";
import type {
  Department,
  Leader,
  Session,
  WorkspaceState,
  WorkspaceAction,
} from "@moc/shared";

const environment = (
  import.meta as ImportMeta & { env?: Record<string, string> }
).env;
export const API_URL = environment?.VITE_API_URL || "http://localhost:3001";
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    credentials: "include",
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const body = await response
    .json()
    .catch(() => ({ error: "The API returned an unexpected response." }));
  if (!response.ok)
    throw new ApiError(
      body.error || "The request could not be completed.",
      response.status,
    );
  return body as T;
}
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: true, staleTime: 15000 },
  },
});
export function ClientProvider({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
const empty: WorkspaceState = {
  tasks: [],
  requests: [],
  users: [],
  activities: [],
  notifications: [],
};
export function useSession() {
  const query = useQuery({
    queryKey: ["session"],
    queryFn: async () => {
      const session = await api<Session>("/api/session");
      if (
        session.demo &&
        !session.user &&
        window.location.pathname !== "/login"
      )
        return api<Session>("/api/auth/demo", {
          method: "POST",
          body: JSON.stringify({
            department:
              queryClient.getQueryData<Session>(["session"])?.user
                ?.department || "cell-0",
          }),
        });
      return session;
    },
  });
  return {
    session: query.data,
    loading: query.isPending,
    error: query.error?.message,
    refresh: query.refetch,
  };
}
export function useWorkspace() {
  const client = useQueryClient();
  const { session, loading: sessionLoading } = useSession();
  const query = useQuery({
    queryKey: ["workspace", session?.user?.id],
    queryFn: async () => {
      try {
        return await api<WorkspaceState>("/api/workspace");
      } catch (error) {
        if (error instanceof ApiError && error.status === 401)
          void client.invalidateQueries({ queryKey: ["session"] });
        throw error;
      }
    },
    enabled: !!session?.user,
    refetchInterval: 15000,
  });
  const user = session?.user as Leader;
  async function act(action: WorkspaceAction) {
    const send = () =>
      api<WorkspaceState>("/api/actions", {
        method: "POST",
        body: JSON.stringify(action),
      });
    let result: WorkspaceState;
    try {
      result = await send();
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) throw error;
      await client.invalidateQueries({ queryKey: ["session"] });
      if (!client.getQueryData<Session>(["session"])?.user) throw error;
      result = await send();
    }
    client.setQueryData(["workspace", user.id], result);
  }
  async function switchDepartment(department: Department) {
    const result = await api<Session>("/api/auth/demo", {
      method: "POST",
      body: JSON.stringify({ department }),
    });
    client.removeQueries({ queryKey: ["workspace"] });
    client.setQueryData(["session"], result);
  }
  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    client.clear();
    window.location.assign("/login");
  }
  return {
    state: query.data || empty,
    user,
    demo: session?.demo || false,
    loading: sessionLoading || query.isPending,
    error: query.error?.message,
    act,
    refresh: async () => {
      await query.refetch();
    },
    switchDepartment,
    logout,
  };
}
