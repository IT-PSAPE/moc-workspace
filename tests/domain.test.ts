import { describe, expect, it } from "vitest";
import {
  SERVICES,
  applyAction,
  createRequest,
  createSeedState,
  publicProjection,
  updatePublicRequest,
  validateRequest,
  validateWorkspaceAction,
} from "../packages/shared/src";
import type { RequestInput } from "../packages/shared/src";

const freshInput = (overrides: Partial<RequestInput> = {}): RequestInput => ({
  ministry: "Youth Ministry",
  service: "social-content",
  title: "Upcoming youth event reel",
  instructions: "Create a 30 second recap reel for the event.",
  notes: "Use approved footage and the event title card.",
  dueAt: new Date(Date.now() + 7 * 86400000).toISOString(),
  ...overrides,
});

describe("shared domain model", () => {
  it("routes an approved request through its selected service and preserves the returned reference", () => {
    const state = createSeedState();
    const { state: submitted, request } = createRequest(state, freshInput());
    const cell0 = submitted.users.find((user) => user.department === "cell-0")!;
    const approved = applyAction(submitted, cell0, {
      type: "approve",
      requestId: request.id,
      priority: "high",
    });
    const routed = approved.tasks.find(
      (task) => task.requestId === request.id,
    )!;
    const service = SERVICES.find((item) => item.id === request.service)!;
    expect(routed.department).toBe(service.department);
    expect(routed.subTeam).toBe(service.subTeam);
    expect(
      approved.requests.find((item) => item.id === request.id)?.reference,
    ).toBe(request.reference);
    expect(
      approved.requests.find((item) => item.id === request.id)?.status,
    ).toBe("approved");
    expect(
      approved.activities
        .filter(
          (activity) =>
            activity.type === "approval" && activity.taskId === routed.id,
        )
        .map((activity) => activity.department)
        .sort(),
    ).toEqual(["cell-0", service.department].sort());
    expect(
      approved.notifications
        .filter(
          (item) =>
            item.text.includes(request.reference) &&
            item.text.includes("approved and routed"),
        )
        .map((item) => item.department)
        .sort(),
    ).toEqual(["cell-0", service.department].sort());
  });

  it("includes the requested service catalog and routes each service through an assigned team", () => {
    const ids = new Set(SERVICES.map((service) => service.id));
    for (const id of [
      "education-support",
      "video-creation",
      "decor",
      "set-design",
      "banners",
      "websites",
      "flyers",
      "books-booklets",
      "email-design",
      "sound-equipment-support",
      "previously-aired-video",
    ]) {
      expect(ids.has(id), `missing service ${id}`).toBe(true);
      const service = SERVICES.find((item) => item.id === id)!;
      expect(service.department).toBeTruthy();
      expect(service.subTeam).toBeTruthy();
    }
    expect(
      SERVICES.find((service) => service.id === "education-support")
        ?.department,
    ).toBe("sound");
    expect(
      SERVICES.find((service) => service.id === "previously-aired-video")
        ?.requiresAiredDates,
    ).toBe(true);
  });

  it("keeps seeded task titles aligned with their assigned teams", () => {
    const tasks = createSeedState().tasks;
    expect(
      tasks.find((task) => task.title === "Sunday service opening montage"),
    ).toMatchObject({
      service: "video-creation",
      department: "visual-media",
      subTeam: "Video",
    });
    expect(
      tasks.find((task) => task.title === "Guest speaker sound check"),
    ).toMatchObject({
      service: "live-sound",
      department: "sound",
      subTeam: "Sound",
    });
    expect(
      tasks.find((task) => task.title === "Men’s breakfast event photos"),
    ).toMatchObject({
      service: "event-photography",
      department: "visual-media",
      subTeam: "Photography",
    });
    expect(new Set(tasks.map((task) => task.department))).toEqual(
      new Set(["cell-0", "sound", "design", "visual-media"]),
    );
  });

  it("limits department leaders to editing and notes in their department", () => {
    const state = createSeedState();
    const leader = state.users.find((user) => user.department === "design")!;
    const foreignTask = state.tasks.find(
      (task) => task.department === "sound",
    )!;
    expect(() =>
      applyAction(state, leader, {
        type: "update-task",
        taskId: foreignTask.id,
        progress: 50,
      }),
    ).toThrow(/only edit tasks in your department/i);
    expect(() =>
      applyAction(state, leader, {
        type: "add-note",
        taskId: foreignTask.id,
        text: "private",
      }),
    ).toThrow(/only add private notes to tasks in your department/i);
    const ownTask = state.tasks.find((task) => task.department === "design")!;
    const edited = applyAction(state, leader, {
      type: "update-task",
      taskId: ownTask.id,
      progress: 50,
    });
    expect(edited.tasks.find((task) => task.id === ownTask.id)?.progress).toBe(
      50,
    );
    const withNote = applyAction(state, leader, {
      type: "add-note",
      taskId: ownTask.id,
      text: "Team only follow-up.",
    });
    expect(
      withNote.tasks.find((task) => task.id === ownTask.id)?.privateNotes.at(-1)
        ?.text,
    ).toBe("Team only follow-up.");
    expect(withNote.activities.at(-1)?.text).not.toContain(
      "Team only follow-up.",
    );
    expect(() =>
      applyAction(
        state,
        { ...leader, approved: false },
        { type: "update-task", taskId: ownTask.id, progress: 25 },
      ),
    ).toThrow(/not been approved/i);
    expect(() =>
      applyAction(
        {
          ...state,
          users: state.users.filter((item) => item.id !== leader.id),
        },
        leader,
        { type: "update-task", taskId: ownTask.id, progress: 25 },
      ),
    ).toThrow(/not been approved/i);
  });

  it("enforces rank and department roles when granting leader access", () => {
    const state = createSeedState();
    const cell0 = state.users.find((user) => user.department === "cell-0")!;
    const base = {
      name: "New Leader",
      email: "new-leader@example.org",
      approved: false,
    };
    expect(() =>
      applyAction(state, cell0, {
        type: "add-user",
        input: { ...base, rank: "CMN", department: "sound" },
      }),
    ).toThrow(/rank does not match/i);
    expect(() =>
      applyAction(state, cell0, {
        type: "add-user",
        input: { ...base, rank: "GJN", department: "cell-0" },
      }),
    ).toThrow(/rank does not match/i);
    const valid = applyAction(state, cell0, {
      type: "add-user",
      input: { ...base, rank: "TJN", department: "sound" },
    });
    expect(
      valid.users.some(
        (user) => user.email === base.email && user.rank === "TJN",
      ),
    ).toBe(true);
  });

  it("requires rejection reasons and exposes only safe task tracking fields", () => {
    const state = createSeedState();
    const cell0 = state.users.find((user) => user.department === "cell-0")!;
    const { state: submitted, request } = createRequest(state, freshInput());
    expect(() =>
      applyAction(submitted, cell0, {
        type: "reject",
        requestId: request.id,
        reason: "  ",
      }),
    ).toThrow(/rejection reason/i);
    const routed = applyAction(submitted, cell0, {
      type: "approve",
      requestId: request.id,
      priority: "medium",
    });
    const task = routed.tasks.find((item) => item.requestId === request.id)!;
    const withNote = applyAction(routed, cell0, {
      type: "add-note",
      taskId: task.id,
      text: "Only the production team sees this.",
    });
    const result = publicProjection(
      withNote,
      request.reference,
      request.ministry,
    )!;
    expect(result.task).toEqual(
      expect.objectContaining({
        status: "pending",
        progress: 0,
        department: "visual-media",
      }),
    );
    expect(result.task).not.toHaveProperty("privateNotes");
    expect(result.request.reference).toBe(request.reference);
  });

  it("records new and rejected requests for Cell 0 only", () => {
    const initial = createSeedState();
    const { state, request } = createRequest(initial, freshInput());
    expect(state.activities.at(-1)?.type).toBe("request");
    expect(state.activities.at(-1)?.department).toBe("cell-0");
    expect(state.notifications.at(-1)?.department).toBe("cell-0");
    const cell0 = state.users.find((user) => user.department === "cell-0")!;
    const rejected = applyAction(state, cell0, {
      type: "reject",
      requestId: request.id,
      reason: "Please update the due date.",
    });
    expect(rejected.activities.at(-1)).toMatchObject({
      type: "rejection",
      department: "cell-0",
    });
    expect(rejected.notifications.at(-1)?.department).toBe("cell-0");
    expect(rejected.notifications.at(-1)?.text).toContain(
      "Please update the due date.",
    );
  });

  it("copies only public request fields and ignores forged server metadata", () => {
    const injected = Object.assign(freshInput(), {
      id: "forged-request-id",
      reference: "MOC-2099-9999",
      status: "approved",
      taskId: "task-demo-cell0-01",
      privateNotes: [{ text: "forged private note" }],
      rejectionReason: "forged",
      trackingCodeHash: "attacker-controlled-digest",
    });
    const { state, request } = createRequest(createSeedState(), injected);
    expect(request).not.toHaveProperty("privateNotes");
    expect(request).not.toHaveProperty("trackingCodeHash");
    expect(request.taskId).toBeUndefined();
    expect(request.id).not.toBe("forged-request-id");
    expect(request.reference).not.toBe("MOC-2099-9999");
    expect(
      publicProjection(state, request.reference, request.ministry)?.task,
    ).toBeNull();
  });

  it("sets completion timestamps when progress reaches 100 percent", () => {
    const state = createSeedState();
    const user = state.users.find(
      (item) => item.department === "visual-media",
    )!;
    const task = state.tasks.find(
      (item) => item.department === user.department && item.progress < 100,
    )!;
    const updated = applyAction(state, user, {
      type: "update-task",
      taskId: task.id,
      progress: 100,
    });
    const completed = updated.tasks.find((item) => item.id === task.id)!;
    expect(completed.status).toBe("completed");
    expect(completed.completedAt).toBeTruthy();
  });

  it("keeps progress and status synchronized when completing or reopening tasks", () => {
    const state = createSeedState();
    const cell0 = state.users.find((user) => user.department === "cell-0")!;
    const completedTask = state.tasks.find(
      (task) => task.status === "completed",
    )!;
    const originalCompletedAt = completedTask.completedAt;
    const priorityOnly = applyAction(state, cell0, {
      type: "update-task",
      taskId: completedTask.id,
      priority: "urgent",
    });
    expect(
      priorityOnly.tasks.find((task) => task.id === completedTask.id),
    ).toMatchObject({
      progress: 100,
      status: "completed",
      completedAt: originalCompletedAt,
    });
    expect(
      priorityOnly.notifications.filter(
        (item) => item.text === `${completedTask.title} completed.`,
      ),
    ).toHaveLength(0);
    const conflicting = applyAction(priorityOnly, cell0, {
      type: "update-task",
      taskId: completedTask.id,
      progress: 50,
      status: "completed",
    });
    expect(
      conflicting.tasks.find((task) => task.id === completedTask.id),
    ).toMatchObject({ progress: 100, status: "completed" });
    const backInProgress = applyAction(conflicting, cell0, {
      type: "update-task",
      taskId: completedTask.id,
      status: "in-progress",
    });
    expect(
      backInProgress.tasks.find((task) => task.id === completedTask.id),
    ).toMatchObject({ progress: 75, status: "in-progress" });
    expect(
      backInProgress.tasks.find((task) => task.id === completedTask.id)
        ?.completedAt,
    ).toBeUndefined();
    const pending = applyAction(backInProgress, cell0, {
      type: "update-task",
      taskId: completedTask.id,
      status: "pending",
    });
    expect(
      pending.tasks.find((task) => task.id === completedTask.id),
    ).toMatchObject({ progress: 0, status: "pending" });
    const newlyCompleted = applyAction(pending, cell0, {
      type: "update-task",
      taskId: completedTask.id,
      progress: 100,
    });
    expect(
      newlyCompleted.notifications
        .filter((item) => item.text === `${completedTask.title} completed.`)
        .map((item) => item.department)
        .sort(),
    ).toEqual(["cell-0", completedTask.department].sort());
    expect(
      newlyCompleted.activities.filter(
        (item) => item.type === "completed" && item.taskId === completedTask.id,
      ),
    ).toHaveLength(2);
  });

  it("allows Cell 0 to create private internal work", () => {
    const state = createSeedState();
    const cell0 = state.users.find((user) => user.department === "cell-0")!;
    const updated = applyAction(state, cell0, {
      type: "create-task",
      input: {
        title: "Private leadership follow-up",
        department: "cell-0",
        subTeam: "Cell 0",
        priority: "high",
        dueAt: new Date(Date.now() + 86400000).toISOString(),
        instructions: "Prepare the leadership agenda.",
        notes: "Keep the discussion confidential.",
      },
    });
    expect(updated.tasks.at(-1)).toMatchObject({
      title: "Private leadership follow-up",
      department: "cell-0",
      subTeam: "Cell 0",
    });
    expect(state.tasks.some((task) => task.department === "cell-0")).toBe(true);
  });

  it("validates untrusted workspace action payloads before state changes", () => {
    expect(() =>
      validateWorkspaceAction({
        type: "update-task",
        taskId: "t1",
        progress: 120,
        status: "broken",
      }),
    ).toThrow(/progress must be/i);
    expect(() =>
      validateWorkspaceAction({
        type: "update-task",
        taskId: "t1",
        progress: 25,
        status: "broken",
      }),
    ).toThrow(/valid task status/i);
    expect(() =>
      validateWorkspaceAction({
        type: "update-task",
        taskId: "t1",
        priority: "critical",
      }),
    ).toThrow(/valid task priority/i);
    expect(() => validateWorkspaceAction({ type: "other-action" })).toThrow(
      /valid workspace action/i,
    );
    expect(() =>
      validateWorkspaceAction({
        type: "add-user",
        input: {
          name: "Leader",
          email: "leader@example.org",
          department: "design",
          rank: "CMN",
          approved: "yes",
        },
      }),
    ).toThrow(/approval must be true or false/i);
  });

  it("validates catalog IDs, required notes, future due dates and exact aired dates", () => {
    expect(() =>
      validateRequest(freshInput({ service: "Video Editing" })),
    ).toThrow(/valid service/i);
    expect(() => validateRequest(freshInput({ notes: "   " }))).toThrow(
      /notes are required/i,
    );
    expect(() =>
      validateRequest(
        freshInput({ dueAt: new Date(Date.now() - 1000).toISOString() }),
      ),
    ).toThrow(/future/i);
    expect(() =>
      validateRequest(freshInput({ dueAt: "2099-02-30T12:00:00Z" })),
    ).toThrow(/valid due date/i);
    expect(() => validateRequest(freshInput({ dueAt: "2099-12-30" }))).toThrow(
      /valid due date/i,
    );
    expect(() =>
      validateRequest(freshInput({ service: "previously-aired-video" })),
    ).toThrow(/aired date/i);
    expect(() =>
      validateRequest(
        freshInput({
          service: "previously-aired-video",
          airedDates: ["2026-9-1"],
        }),
      ),
    ).toThrow(/YYYY-MM-DD/i);
    expect(() =>
      validateRequest(
        freshInput({
          service: "previously-aired-video",
          airedDates: ["2025-02-29"],
        }),
      ),
    ).toThrow(/YYYY-MM-DD/i);
    expect(() =>
      validateRequest(
        freshInput({
          service: "previously-aired-video",
          airedDates: ["2024-02-29"],
        }),
      ),
    ).not.toThrow();
    expect(() =>
      validateRequest(
        freshInput({
          service: "previously-aired-video",
          airedDates: ["2099-01-01"],
        }),
      ),
    ).toThrow(/cannot be in the future/i);
    expect(() =>
      validateRequest(
        freshInput({
          service: "previously-aired-video",
          airedDates: [new Date().toISOString().slice(0, 10)],
        }),
      ),
    ).not.toThrow();
    expect(() =>
      validateRequest(
        freshInput({
          service: "previously-aired-video",
          airedDates: ["2026-09-01"],
        }),
      ),
    ).not.toThrow();
  });

  it("allows a public edit only while pending and preserves the MOC reference", () => {
    const base = createRequest(createSeedState(), freshInput());
    const state = {
      ...base.state,
      requests: base.state.requests.map((item) =>
        item.id === base.request.id
          ? { ...item, trackingCodeHash: "a".repeat(64) }
          : item,
      ),
    };
    const request = state.requests.find((item) => item.id === base.request.id)!;
    const original = request;
    const injected = Object.assign(
      freshInput({ title: "Updated youth reel" }),
      {
        id: "forged-edit-id",
        reference: "MOC-2099-9999",
        status: "approved",
        createdAt: "1999-01-01T00:00:00Z",
        taskId: "task-demo-cell0-01",
        privateNotes: [{ text: "forged private note" }],
        rejectionReason: "forged",
      },
    );
    const edited = updatePublicRequest(
      state,
      request.reference,
      request.ministry,
      injected,
    );
    expect(edited.request.reference).toBe(request.reference);
    expect(edited.request.id).toBe(original.id);
    expect(edited.request.createdAt).toBe(original.createdAt);
    expect(edited.request.title).toBe("Updated youth reel");
    expect(edited.request.status).toBe("pending");
    expect(edited.request.taskId).toBeUndefined();
    expect(edited.request.trackingCodeHash).toBe("a".repeat(64));
    expect(edited.request).not.toHaveProperty("privateNotes");
    expect(
      publicProjection(edited.state, request.reference, request.ministry)?.task,
    ).toBeNull();
    expect(
      publicProjection(edited.state, request.reference, request.ministry)
        ?.request,
    ).not.toHaveProperty("trackingCodeHash");
    expect(edited.state.activities.at(-1)?.text).toContain("was edited");
    expect(edited.state.notifications.at(-1)?.text).toContain("was updated");
    const cell0 = edited.state.users.find(
      (user) => user.department === "cell-0",
    )!;
    const approved = applyAction(edited.state, cell0, {
      type: "approve",
      requestId: request.id,
      priority: "low",
    });
    expect(() =>
      updatePublicRequest(
        approved,
        request.reference,
        request.ministry,
        freshInput(),
      ),
    ).toThrow(/only pending/i);
  });
});
