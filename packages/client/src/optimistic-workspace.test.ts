import { describe, expect, it } from "vitest";
import { applyAction, createSeedState, workspaceActionPatch, type WorkspaceAction } from "@moc/shared";
import { OptimisticWorkspace } from "./optimistic-workspace";

function setup() {
  const state = createSeedState();
  const user = state.users.find((member) => member.department === "cell-0" && member.isLeader)!;
  const task = state.tasks[0];
  return { state, user, task, journal: new OptimisticWorkspace(state, user.id) };
}

describe("optimistic saves", () => {
  it("shows the change before confirmation and rolls it back on failure", () => {
    const { state, task, journal } = setup();
    const save = journal.begin({ type: "update-task", taskId: task.id, status: "completed" });
    expect(journal.state.tasks[0].status).toBe("completed");
    expect(state.tasks[0].status).toBe(task.status);
    expect(journal.finish(save)).toEqual(state);
  });

  it("replaces temporary comment IDs/timestamps with one canonical server comment", () => {
    const { state, user, task, journal } = setup();
    const action: WorkspaceAction = { type: "add-note", taskId: task.id, text: "  Save me  " };
    const save = journal.begin(action);
    const optimisticId = journal.state.tasks[0].privateNotes.at(-1)!.id;
    const server = applyAction(state, user, action);
    expect(server.tasks[0].privateNotes.at(-1)!.id).not.toBe(optimisticId);
    expect(journal.finish(save, { ok: true, changes: workspaceActionPatch(state, server, action) })).toEqual(server);
  });

  it("keeps a second pending comment when the first save fails", () => {
    const { state, task, user, journal } = setup();
    const first = journal.begin({ type: "add-note", taskId: task.id, text: "Fails" });
    const action: WorkspaceAction = { type: "add-note", taskId: task.id, text: "Succeeds" };
    const second = journal.begin(action);
    const pendingId = journal.state.tasks[0].privateNotes.at(-1)!.id;
    journal.finish(first);
    expect(journal.state.tasks[0].privateNotes.at(-1)!.id).toBe(pendingId);
    expect(journal.state.tasks[0].privateNotes.map((note) => note.text)).not.toContain("Fails");
    expect(journal.state.tasks[0].privateNotes.at(-1)!.text).toBe("Succeeds");
    const server = applyAction(state, user, action);
    expect(journal.finish(second, { ok: true, changes: workspaceActionPatch(state, server, action) })).toEqual(server);
  });

  it("does not undo an acknowledged edit when a later save fails", () => {
    const { state, task, user, journal } = setup();
    const action: WorkspaceAction = { type: "update-task", taskId: task.id, status: "completed" };
    const first = journal.begin(action);
    const second = journal.begin({ type: "add-note", taskId: task.id, text: "Fails" });
    const server = applyAction(state, user, action);
    journal.finish(first, { ok: true, changes: workspaceActionPatch(state, server, action) });
    expect(journal.state.tasks[0].privateNotes.at(-1)?.text).toBe("Fails");
    expect(journal.finish(second)).toEqual(server);
  });

  it("blocks actions on an item whose server ID has not been confirmed", () => {
    const { state, journal } = setup();
    journal.begin({ type: "save-banner-quote", quote: { text: "Keep going", author: "Team" } });
    const quote = journal.state.bannerQuotes!.quotes.at(-1)!;
    expect(() => journal.begin({ type: "set-banner-quote-today", quoteId: quote.id })).toThrow(/still saving/);
    expect(state.bannerQuotes?.quotes.some((item) => item.id === quote.id)).toBeFalsy();
  });

  it("does not resurrect a failed ministry rename through a later array edit", () => {
    const { state, journal } = setup();
    const firstName = state.catalog.ministries[0];
    const secondName = state.catalog.ministries[1];
    const first = journal.begin({ type: "save-ministry", previousName: firstName, name: "Failed rename" });
    journal.begin({ type: "save-ministry", previousName: secondName, name: "Pending rename" });
    journal.finish(first);
    expect(journal.state.catalog.ministries).toContain(firstName);
    expect(journal.state.catalog.ministries).toContain("Pending rename");
    expect(journal.state.catalog.ministries).not.toContain("Failed rename");
    expect(journal.state.catalog.ministries).not.toContain(secondName);
  });
});
