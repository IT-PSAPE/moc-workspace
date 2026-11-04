import { describe, expect, it } from "vitest";
import { createSeedState } from "@moc/shared";
import { liveEventCheckpoint, priorityLiveRecipients } from "./live-events";

function fixture() {
  const state = createSeedState();
  const admin = state.users.find((user) => user.department === "cell-0" && user.approved)!;
  const sound = state.users.find((user) => user.department === "sound" && user.approved)!;
  state.users.push({ ...admin, id: "cell0-member", name: "Cell 0 member", email: "cell0-member@example.org", isLeader: false });
  state.users.push({ ...sound, id: "sound-member", name: "Sound member", email: "sound-member@example.org", isLeader: false });
  state.tasks = [{ ...state.tasks[0]!, id: "sound-task", department: "sound", subTeam: sound.groups[0]!, requestId: undefined, privateNotes: [] }];
  const checkpoint = liveEventCheckpoint(state);
  const comment = { id: "fresh-comment", text: "Please check this", author: admin.name, createdAt: new Date().toISOString() };
  return { state, admin, sound, checkpoint, comment };
}

describe("priority live updates", () => {
  it("does not signal status, assignment, notification, catalog or member edits", () => {
    const { state, checkpoint } = fixture();
    const next = structuredClone(state);
    next.tasks[0]!.status = "completed";
    next.tasks[0]!.title = "Reassigned task";
    next.catalog.ministries.push("Another ministry");
    next.users[0]!.name = "Updated member";
    next.notifications = [];
    expect(priorityLiveRecipients(checkpoint, next)).toEqual([]);
  });

  it("signals new requests only to approved Cell 0 leaders", () => {
    const { state, checkpoint, admin } = fixture();
    state.requests.push({ ...state.requests[0]!, id: "fresh-request", status: "backlog", privateNotes: [] });
    expect(priorityLiveRecipients(checkpoint, state)).toEqual([admin.id]);
  });

  it("signals a task comment only to members who can read those private notes", () => {
    const { state, checkpoint, admin, sound, comment } = fixture();
    state.tasks[0]!.privateNotes.push(comment);
    expect(priorityLiveRecipients(checkpoint, state).sort()).toEqual([admin.id, sound.id, "sound-member"].sort());
    state.users.find((user) => user.id === sound.id)!.approved = false;
    expect(priorityLiveRecipients(checkpoint, state).sort()).toEqual([admin.id, "sound-member"].sort());
  });

  it("includes Cell 0 members for comments on approved request-linked tasks", () => {
    const { state, checkpoint, admin, sound, comment } = fixture();
    state.requests[0] = { ...state.requests[0]!, status: "approved", taskId: "sound-task" };
    state.tasks[0]!.requestId = state.requests[0]!.id;
    state.tasks[0]!.privateNotes.push(comment);
    expect(priorityLiveRecipients(checkpoint, state).sort()).toEqual([admin.id, sound.id, "sound-member", "cell0-member"].sort());
  });

  it("signals a pre-approval request comment only to Cell 0 leaders", () => {
    const { state, checkpoint, admin, comment } = fixture();
    state.requests[0] = { ...state.requests[0]!, status: "backlog", taskId: undefined, privateNotes: [comment] };
    expect(priorityLiveRecipients(checkpoint, state)).toEqual([admin.id]);
  });

  it("does not treat comments copied during approval as newly posted comments", () => {
    const { state, comment } = fixture();
    state.requests[0] = { ...state.requests[0]!, status: "backlog", privateNotes: [comment] };
    const checkpoint = liveEventCheckpoint(state);
    state.requests[0] = { ...state.requests[0]!, status: "approved", taskId: "sound-task" };
    state.tasks[0]!.privateNotes.push(comment);
    expect(priorityLiveRecipients(checkpoint, state)).toEqual([]);
  });

  it("does not signal comment edits or removals, and never includes revoked recipients", () => {
    const { state, comment } = fixture();
    state.tasks[0]!.privateNotes.push(comment);
    const checkpoint = liveEventCheckpoint(state);
    state.tasks[0]!.privateNotes[0]!.text = "Edited text";
    expect(priorityLiveRecipients(checkpoint, state)).toEqual([]);
    state.tasks[0]!.privateNotes = [];
    expect(priorityLiveRecipients(checkpoint, state)).toEqual([]);
    state.tasks[0]!.privateNotes.push({ ...comment, id: "another-comment" });
    state.users.forEach((user) => { user.approved = false; });
    expect(priorityLiveRecipients(checkpoint, state)).toEqual([]);
  });
});
