import { describe, expect, it } from "vitest";
import { applyStatePatch, statePatch, workspaceActionPatch } from "./state-patch";
import { createSeedState } from "./seed";

describe("compact corrections", () => {
  it("handles nested additions, removals, reordering and optional fields", () => {
    const before = { rows: [{ id: "a", value: 1 }, { id: "b", value: 2 }], optional: true };
    const after = { rows: [{ id: "b", value: 3 }, { id: "c", value: 4 }] };
    expect(applyStatePatch(before, statePatch(before, after))).toEqual(after);
    expect(applyStatePatch(after, statePatch(after, before))).toEqual(before);
    expect(applyStatePatch(before, statePatch(before, before))).toBe(before);
  });

  it("sends a new comment without retransmitting earlier comments or other tasks", () => {
    const before = createSeedState();
    before.tasks[0].privateNotes = [{ id: "old", text: "Existing private comment", author: "Team", createdAt: "2026-01-01" }];
    const after = structuredClone(before);
    after.tasks[0].privateNotes.push({ id: "new", text: "New comment", author: "Team", createdAt: "2026-01-02" });
    const patch = statePatch(before, after);
    expect(JSON.stringify(patch)).not.toContain("Existing private comment");
    expect(JSON.stringify(patch).length).toBeLessThan(1000);
    expect(applyStatePatch(before, patch)).toEqual(after);
  });

  it("confirms a status that another client already saved", () => {
    const stale = createSeedState();
    const server = structuredClone(stale);
    server.tasks[0].status = "completed";
    const patch = workspaceActionPatch(server, server, { type: "update-task", taskId: server.tasks[0].id, status: "completed" });
    expect(applyStatePatch(stale, patch).tasks[0]).toEqual(server.tasks[0]);
  });

  it("confirms member moves that are already current on the server", () => {
    const stale = createSeedState();
    const server = structuredClone(stale);
    const member = server.users.find((user) => user.department === "sound")!;
    member.department = "design";
    member.groups = [server.catalog.departments.find((department) => department.id === "design")!.groups[0]];
    const patch = workspaceActionPatch(server, server, { type: "move-members", userIds: [member.id], department: member.department, groups: member.groups });
    expect(applyStatePatch(stale, patch).users.find((user) => user.id === member.id)).toEqual(member);
  });
});
