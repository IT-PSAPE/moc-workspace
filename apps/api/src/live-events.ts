import type { WorkspaceState } from "@moc/shared";

export function liveEventCheckpoint(state: WorkspaceState) {
  return {
    requests: new Set(state.requests.map((request) => request.id)),
    comments: new Set([
      ...state.tasks.flatMap((task) => task.privateNotes.map((note) => note.id)),
      ...state.requests.flatMap((request) => (request.privateNotes ?? []).map((note) => note.id)),
    ]),
  };
}

/** Match existing request/comment visibility without emitting private metadata. */
export function priorityLiveRecipients(before: ReturnType<typeof liveEventCheckpoint>, next: WorkspaceState): string[] {
  const newRequest = next.requests.some((request) => !before.requests.has(request.id));
  const requestComment = next.requests.some((request) =>
    request.privateNotes?.some((note) => !before.comments.has(note.id)));
  const commentedTasks = next.tasks.filter((task) =>
    task.privateNotes.some((note) => !before.comments.has(note.id)));
  if (!newRequest && !requestComment && !commentedTasks.length) return [];

  // Cell 0 members can read notes on approved request-linked tasks, while
  // Cell 0 leaders can read all task notes. Other members see their department.
  const approvedRequests = next.requests.filter((request) => request.status === "approved");
  const requestTaskIds = new Set(approvedRequests.flatMap((request) => request.taskId ? [request.taskId] : []));
  return next.users.filter((member) => {
    if (!member.approved) return false;
    const cell0 = member.department === "cell-0";
    if (cell0 && member.isLeader) return true;
    return commentedTasks.some((task) => task.department === member.department || (cell0 && (
      requestTaskIds.has(task.id) || approvedRequests.some((request) => !request.taskId && request.id === task.requestId)
    )));
  }).map((member) => member.id);
}
