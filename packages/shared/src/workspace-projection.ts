import type { Session, WorkspaceState } from "./types";

export function projectWorkspace(
  state: WorkspaceState,
  user: NonNullable<Session["user"]>,
): WorkspaceState {
  if (user.department === "cell-0" && user.isLeader) {
    const { deletedRequestSequences: _deletedRequestSequences, ...visibleState } = state;
    return {
      ...visibleState,
      requests: state.requests.map(
        ({ trackingCodeHash: _trackingCodeHash, ...request }) => request,
      ),
    };
  }
  const cell0RequestTaskIds = new Set<string>();
  if (user.department === "cell-0") {
    const approvedRequests = new Map(
      state.requests
        .filter((request) => request.status === "approved")
        .map((request) => [request.id, request]),
    );
    const assignedTaskIds = new Set(
      [...approvedRequests.values()].flatMap((request) =>
        request.taskId ? [request.taskId] : [],
      ),
    );
    for (const task of state.tasks) {
      const request = task.requestId
        ? approvedRequests.get(task.requestId)
        : undefined;
      if (
        assignedTaskIds.has(task.id) ||
        (request && !request.taskId)
      )
        cell0RequestTaskIds.add(task.id);
    }
  }
  const publicTasks = state.tasks.filter((task) =>
    user.department === "cell-0"
      ? task.department === "cell-0" || cell0RequestTaskIds.has(task.id)
      : task.department !== "cell-0",
  );
  return {
    catalog: state.catalog,
    bannerQuotes: state.bannerQuotes ? { quotes: [], daily: state.bannerQuotes.daily } : undefined,
    tasks: publicTasks.map((task) =>
      task.department === user.department || cell0RequestTaskIds.has(task.id)
        ? task
        : { ...task, privateNotes: [] },
    ),
    requests: user.department === "cell-0"
      ? state.requests.map(({ trackingCodeHash: _trackingCodeHash, ...request }) => request)
      : [],
    users: state.users.filter((leader) => leader.id === user.id),
    activities: state.activities.filter(
      (activity) => activity.department === user.department,
    ),
    notifications: state.notifications.filter(
      (notification) => notification.department === user.department,
    ),
  };
}
