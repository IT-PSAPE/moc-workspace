import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { createRealtimeClient, type SealedLiveQuery } from "@neon/realtime/client";
import { RealtimeProvider, useLiveQuery } from "@neon/realtime-react";
import { authHeaders, neonAuth } from "./auth";
import { millisecondsUntilNextQuoteDay } from "@moc/shared";
export { neonAuth, signInWithGoogle } from "./auth";
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
    headers: { "Content-Type": "application/json", ...(/\/api\/(session|workspace|actions|integrations|reports)(\/|$)/.test(path) ? await authHeaders() : {}), ...options.headers },
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
interface WorkspaceRevision { id: string; revision: string }
const realtimeClient = environment?.VITE_NEON_REALTIME_URL
  ? createRealtimeClient({ url: environment.VITE_NEON_REALTIME_URL }) : null;

export function ClientProvider({ children, liveWorkspace = false }: { children: ReactNode; liveWorkspace?: boolean }) {
  const content = <QueryClientProvider client={queryClient}>
    {liveWorkspace && realtimeClient ? <WorkspaceRealtimeSync /> : null}
    {children}
  </QueryClientProvider>;
  return liveWorkspace && realtimeClient
    ? <RealtimeProvider client={realtimeClient}>{content}</RealtimeProvider> : content;
}

function WorkspaceRealtimeSync() {
  const { session } = useSession();
  const userId = session?.user?.approved ? session.user.id : undefined;
  const queryKey = ["workspace-live", userId];
  const fetchSealed = useCallback(() => api<SealedLiveQuery<WorkspaceRevision>>("/api/workspace/live", { method: "POST" }), [userId]);
  const sealed = useQuery({ queryKey, queryFn: fetchSealed, enabled: Boolean(userId), refetchOnWindowFocus: false });
  return userId && sealed.data ? <LiveWorkspaceRevision key={`${userId}-${sealed.data.capability}`} sealed={sealed.data} refresh={fetchSealed} /> : null;
}

function LiveWorkspaceRevision({ sealed, refresh }: { sealed: SealedLiveQuery<WorkspaceRevision>; refresh: () => Promise<SealedLiveQuery<WorkspaceRevision>> }) {
  const { data, status } = useLiveQuery(sealed, { refreshQuery: refresh });
  const revision = data?.[0]?.revision;
  const previous = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (status !== "live" || data === undefined) return;
    if (!data.length) {
      queryClient.removeQueries({ queryKey: ["workspace"] });
      void queryClient.invalidateQueries({ queryKey: ["session"] });
    } else if (previous.current !== revision) {
      previous.current = revision;
      void queryClient.invalidateQueries({ queryKey: ["workspace"] });
    }
  }, [data, revision, status]);
  return status === "error" ? <span role="status" className="sr-only">Live updates paused. Refresh to reconnect.</span> : null;
}
const empty: WorkspaceState = {
  catalog: { ministries: [], services: [], departments: [] },
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
    enabled: !!session?.user?.approved,
    // A page mounting after the shell's initial failure must not restart the
    // same failed request and replace the recovery UI with another loader.
    retryOnMount: false,
    refetchInterval: () => Math.min(15000, millisecondsUntilNextQuoteDay()),
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
    const updatedMember = result.users.find((member) => member.id === user.id);
    if (updatedMember)
      client.setQueryData<Session>(["session"], (current) =>
        current ? { ...current, user: updatedMember } : current,
      );
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
    if (neonAuth) {
      const { error } = await neonAuth.signOut();
      if (error) throw new Error(error.message || "Sign-out failed.");
    }
    await api("/api/auth/logout", { method: "POST" });
    client.clear();
    window.location.assign("/login");
  }
  return {
    state: query.data || empty,
    user,
    demo: session?.demo || false,
    loading: sessionLoading || query.isLoading,
    initialError: query.isError && !query.data,
    error: query.error?.message,
    act,
    refresh: async () => {
      await query.refetch();
    },
    switchDepartment,
    logout,
  };
}
