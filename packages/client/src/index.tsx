import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
  useMutation,
  useIsMutating,
  queryOptions,
  focusManager,
} from "@tanstack/react-query";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { OptimisticWorkspace } from "./optimistic-workspace";
import { subscribeWorkspaceEvents } from "./live";
import { isPermanentRequestError, PUBLIC_CATALOG_REFRESH_MS, retryQuery, workspaceRefetchInterval } from "./query-policy";
export { authErrorMessages, signInWithGoogle } from "./auth";
import type {
  Department,
  Leader,
  Session,
  WorkspaceState,
  WorkspaceAction,
  Catalog,
  ActionReceipt,
} from "@moc/shared";

const environment = (
  import.meta as ImportMeta & { env?: Record<string, string> }
).env;
export const API_URL = environment?.DEV ? environment?.VITE_API_URL?.replace(/\/$/, "") || "" : "";
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
    queries: {
      retry: retryQuery,
      refetchOnWindowFocus: (query) => !isPermanentRequestError(query.state.error),
      refetchOnReconnect: (query) => !isPermanentRequestError(query.state.error),
      staleTime: 60_000,
    },
  },
});
export const publicCatalogOptions = queryOptions({
  queryKey: ["public-catalog"],
  queryFn: () => api<Catalog>("/api/catalog"),
  staleTime: PUBLIC_CATALOG_REFRESH_MS,
  refetchInterval: (query) => isPermanentRequestError(query.state.error) ? false : PUBLIC_CATALOG_REFRESH_MS,
});
export function ClientProvider({ children, liveWorkspace = false }: { children: ReactNode; liveWorkspace?: boolean }) {
  return <QueryClientProvider client={queryClient}>
    {liveWorkspace ? <WorkspaceSync /> : null}
    {children}
  </QueryClientProvider>;
}

const optimisticSaves = new WeakMap<QueryClient, Map<string, OptimisticWorkspace>>();
function saveJournals(client: QueryClient) {
  let journals = optimisticSaves.get(client);
  if (!journals) { journals = new Map(); optimisticSaves.set(client, journals); }
  return journals;
}

function WorkspaceSync() {
  const { session } = useSession();
  const focused = useSyncExternalStore(focusManager.subscribe, () => focusManager.isFocused(), () => true);
  const userId = session?.user?.approved ? session.user.id : undefined;
  const saving = useIsMutating({ mutationKey: ["workspace-action", userId] });
  // Only this observer owns timers. Pages and dialogs share its cached result.
  useQuery({
    ...workspaceOptions(session, saving),
    refetchInterval: (query) => workspaceRefetchInterval(query.state.error),
    refetchOnWindowFocus: (query) => isPermanentRequestError(query.state.error) ? false : "always",
    refetchOnReconnect: (query) => isPermanentRequestError(query.state.error) ? false : "always",
  });
  return focused && userId ? <LiveWorkspaceRevision key={userId} /> : null;
}

function LiveWorkspaceRevision() {
  const [paused, setPaused] = useState(false);
  useEffect(() => subscribeWorkspaceEvents(`${API_URL}/api/workspace/events`, (signal) => {
    if (signal.event === "connected") { setPaused(false); return; }
    if (signal.event === "paused") { setPaused(true); return; }
    if (signal.event === "revoked") {
      queryClient.removeQueries({ queryKey: ["workspace"] });
      void queryClient.invalidateQueries({ queryKey: ["session"] });
      return;
    }
    setPaused(false);
    for (const journal of saveJournals(queryClient).values()) journal.needsRefresh = true;
    void queryClient.invalidateQueries({ queryKey: ["workspace"], refetchType: queryClient.isMutating({ mutationKey: ["workspace-action"] }) ? "none" : "active" });
  }), []);
  return paused ? <span role="status" className="sr-only">Live updates paused. Refresh to reconnect.</span> : null;
}
const empty: WorkspaceState = {
  catalog: { ministries: [], services: [], departments: [] },
  tasks: [],
  requests: [],
  users: [],
  activities: [],
  notifications: [],
};
function workspaceOptions(session: Session | undefined, saving = 0) {
  return queryOptions({
    queryKey: ["workspace", session?.user?.id],
    queryFn: async ({ signal }) => {
      const cached = queryClient.getQueryData<WorkspaceState>(["workspace", session?.user?.id]);
      if (cached && queryClient.isMutating({ mutationKey: ["workspace-action", session?.user?.id] })) return cached;
      try {
        return await api<WorkspaceState>("/api/workspace", { signal });
      } catch (error) {
        if (error instanceof ApiError && error.status === 401)
          void queryClient.invalidateQueries({ queryKey: ["session"] });
        throw error;
      }
    },
    enabled: !!session?.user?.approved && !saving,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    // New observers must retain the recovery UI after an initial failure.
    retryOnMount: false,
  });
}
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
  const user = session?.user as Leader;
  const userId = user?.id;
  const saving = useIsMutating({ mutationKey: ["workspace-action", userId] });
  const query = useQuery(workspaceOptions(session, saving));
  const workspaceKey = ["workspace", userId];
  const mutation = useMutation({
    mutationKey: ["workspace-action", userId],
    // Network writes share a queue across all pages/dialogs for this member.
    scope: { id: `workspace-action:${userId}` },
    retry: false,
    onMutate: async (action: WorkspaceAction) => {
      await client.cancelQueries({ queryKey: workspaceKey, exact: true });
      const current = client.getQueryData<WorkspaceState>(workspaceKey);
      if (!current || !userId) throw new Error("Please wait for your workspace to load before saving.");
      const journals = saveJournals(client);
      let journal = journals.get(userId);
      if (!journal) { journal = new OptimisticWorkspace(current, userId); journals.set(userId, journal); }
      const save = journal.begin(action);
      client.setQueryData(workspaceKey, journal.state);
      return { journal, save };
    },
    mutationFn: async (action: WorkspaceAction) => {
      const send = () => api<ActionReceipt | WorkspaceState>("/api/actions?response=changes", {
        method: "POST", body: JSON.stringify(action),
      });
      try { return await send(); }
      catch (error) {
        if (!(error instanceof ApiError) || error.status !== 401) throw error;
        await client.invalidateQueries({ queryKey: ["session"] });
        if (!client.getQueryData<Session>(["session"])?.user) throw error;
        return send();
      }
    },
    onSuccess: (result, _action, context) => {
      const state = context.journal.finish(context.save, result);
      const signedIn = client.getQueryData<Session>(["session"])?.user;
      if (signedIn?.id !== userId || !signedIn?.approved) return;
      client.setQueryData(workspaceKey, state);
      const updated = context.journal.confirmedState.users.find((member) => member.id === userId);
      if (updated) client.setQueryData<Session>(["session"], (current) => current?.user?.id === userId ? { ...current, user: updated } : current);
    },
    onError: (_error, _action, context) => {
      if (context) {
        context.journal.needsRefresh = true;
        const state = context.journal.finish(context.save);
        const signedIn = client.getQueryData<Session>(["session"])?.user;
        if (signedIn?.id === userId && signedIn.approved) client.setQueryData(workspaceKey, state);
      }
      // A lost response may still have committed. Reconcile once the write queue drains.
      void client.invalidateQueries({ queryKey: workspaceKey, exact: true, refetchType: "none" });
    },
    onSettled: () => {
      const journal = userId ? saveJournals(client).get(userId) : undefined;
      if (journal?.idle && userId) {
        // setQueryData clears invalidation, so remember signals across every ack.
        if (journal.needsRefresh) void client.invalidateQueries({ queryKey: workspaceKey, exact: true, refetchType: "none" });
        saveJournals(client).delete(userId);
      }
    },
  });
  async function act(action: WorkspaceAction) {
    await mutation.mutateAsync(action);
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
    loading: sessionLoading || query.isLoading,
    initialError: query.isError && !query.data,
    error: query.error?.message,
    act,
    refresh: async () => {
      if (!saving) await query.refetch();
    },
    switchDepartment,
    logout,
  };
}
