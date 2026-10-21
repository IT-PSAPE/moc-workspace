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
    });
    const routed = approved.tasks.find(
      (task) => task.requestId === request.id,
    )!;
    expect(routed).not.toHaveProperty("priority");
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

  it("keeps request comments private, preserves them through edits, and carries them into the assigned task", () => {
    const { state, request } = createRequest(createSeedState(), freshInput());
    const cell0 = state.users.find((user) => user.department === "cell-0")!;
    const leader = state.users.find((user) => user.department === "design")!;
    const action = {
      type: "add-request-note" as const,
      requestId: request.id,
      text: "  Please confirm the approved footage.  ",
    };
    expect(() => applyAction(state, leader, action)).toThrow(
      /only an approved Cell 0/i,
    );
    expect(() => applyAction(state, cell0, { ...action, text: " " })).toThrow(
      /comment/i,
    );
    expect(() =>
      applyAction(state, cell0, { ...action, requestId: "missing" }),
    ).toThrow(/not found/i);
    const commented = applyAction(state, cell0, action);
    const notes = commented.requests.find(
      (item) => item.id === request.id,
    )!.privateNotes!;
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      text: action.text.trim(),
      author: cell0.name,
    });
    expect(
      publicProjection(commented, request.reference, request.ministry)!.request,
    ).not.toHaveProperty("privateNotes");
    const edited = updatePublicRequest(
      commented,
      request.reference,
      request.ministry,
      freshInput({ title: "Updated youth recap" }),
    ).state;
    expect(
      edited.requests.find((item) => item.id === request.id)!.privateNotes,
    ).toEqual(notes);
    const approved = applyAction(edited, cell0, {
      type: "approve",
      requestId: request.id,
    });
    const task = approved.tasks.find((item) => item.requestId === request.id)!;
    expect(task.privateNotes).toEqual(notes);
    const continued = applyAction(approved, cell0, {
      ...action,
      text: "Ready for production.",
    });
    expect(
      continued.tasks.find((item) => item.id === task.id)!.privateNotes,
    ).toHaveLength(2);
    expect(
      publicProjection(continued, request.reference, request.ministry)!.request,
    ).not.toHaveProperty("privateNotes");
    expect(
      publicProjection(continued, request.reference, request.ministry)!.task,
    ).not.toHaveProperty("privateNotes");
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

  it("invites email-bound members and limits member management to Cell 0 leaders", () => {
    const state = createSeedState();
    const cell0 = state.users.find((user) => user.department === "cell-0")!;
    const member = state.users.find((user) => user.department === "design")!;
    const input = {
      name: "New Member",
      email: "new-member@example.org",
      duty: "Camera operator",
      department: "sound",
      groups: ["Sound"],
      isLeader: false,
    };
    expect(() => applyAction(state, member, {
      type: "invite-member",
      input,
    })).toThrow(/Cell 0 leader/i);
    const invited = applyAction(state, cell0, { type: "invite-member", input });
    expect(invited.users.at(-1)).toMatchObject({
      ...input,
      email: input.email,
      approved: true,
      invitedAt: expect.any(String),
    });

    const invitedMember = invited.users.at(-1)!;
    expect(() => applyAction(invited, cell0, {
      type: "update-member",
      userId: invitedMember.id,
      changes: { email: "changed@example.org" },
    })).toThrow(/email/i);
    expect(() => applyAction(invited, cell0, {
      type: "update-member",
      userId: cell0.id,
      changes: { approved: false },
    })).toThrow(/your own Cell 0 admin/i);
    const updated = applyAction(invited, cell0, {
      type: "update-member",
      userId: invitedMember.id,
      changes: { duty: "Mix engineer", isLeader: true },
    });
    expect(updated.users.find((user) => user.id === invitedMember.id)).toMatchObject({
      duty: "Mix engineer",
      isLeader: true,
      email: input.email,
    });
  });

  it("protects department ownership, stable Cell 0 and groups referenced by routing", () => {
    const state = createSeedState();
    const cell0 = state.users.find((user) => user.department === "cell-0")!;
    const design = state.users.find((user) => user.department === "design")!;
    const newDepartment = {
      id: "operations",
      name: "Operations",
      groups: ["Communications"],
      color: "teal" as const,
    };
    expect(() => applyAction(state, design, {
      type: "save-department",
      department: newDepartment,
    })).toThrow(/Cell 0 leader/i);
    const created = applyAction(state, cell0, {
      type: "save-department",
      department: newDepartment,
    });
    const routed = applyAction(created, cell0, {
      type: "save-service",
      service: {
        id: "operations-service",
        name: "Operations service",
        department: "operations",
        subTeam: "Communications",
      },
    });
    expect(() => applyAction(routed, cell0, {
      type: "delete-department",
      departmentId: "operations",
    })).toThrow(/reassign members, services, and tasks/i);
    expect(() => applyAction(routed, cell0, {
      type: "save-department",
      department: {
        ...newDepartment,
        id: "design",
        name: "Design",
        groups: ["Art Production"],
      },
    })).toThrow(/referenced group/i);
    expect(() => applyAction(state, cell0, {
      type: "delete-department",
      departmentId: "cell-0",
    })).toThrow(/cannot be deleted/i);
  });

  it("renames referenced department groups and preserves member, service, and task assignments", () => {
    const state = createSeedState();
    const cell0 = state.users.find((user) => user.department === "cell-0")!;
    const department = state.catalog.departments.find((item) => item.id === "design")!;
    const renamed = applyAction(state, cell0, {
      type: "save-department",
      department: {
        ...department,
        groups: ["Design Studio", "Art Production"],
      },
      groupRenames: { "Graphic Design": "Design Studio" },
    });

    expect(renamed.catalog.services
      .filter((service) => service.department === "design" && service.subTeam === "Design Studio"),
    ).not.toHaveLength(0);
    expect(renamed.users
      .filter((member) => member.department === "design")
      .flatMap((member) => member.groups),
    ).toContain("Design Studio");
    expect(renamed.tasks
      .filter((task) => task.department === "design" && task.subTeam === "Design Studio"),
    ).not.toHaveLength(0);
    expect(() => applyAction(state, cell0, {
      type: "save-department",
      department: {
        ...department,
        groups: ["Design Studio", "Art Production"],
      },
      groupRenames: { "Graphic Design": "Design Studio", "Art Production": "Design Studio" },
    })).toThrow(/same group/i);

    expect(() => applyAction(state, cell0, {
      type: "save-department",
      department: { ...department, groups: ["graphic design", "Art Production"] },
    })).toThrow(/referenced group/i);
    const caseRenamed = applyAction(state, cell0, {
      type: "save-department",
      department: { ...department, groups: ["graphic design", "Art Production"] },
      groupRenames: { "Graphic Design": "graphic design" },
    });
    expect(caseRenamed.catalog.services
      .filter((service) => service.department === "design" && service.subTeam === "graphic design"),
    ).not.toHaveLength(0);
    expect(caseRenamed.tasks
      .filter((task) => task.department === "design" && task.subTeam === "graphic design"),
    ).not.toHaveLength(0);

    const withPrototypeNames = {
      ...state,
      catalog: {
        ...state.catalog,
        departments: state.catalog.departments.map((item) =>
          item.id === "design"
            ? { ...item, groups: [...item.groups, "constructor", "toString"] }
            : item,
        ),
        services: [
          ...state.catalog.services,
          { id: "prototype-service", name: "Prototype service", department: "design", subTeam: "constructor" },
          { id: "string-service", name: "String service", department: "design", subTeam: "toString" },
        ],
      },
      users: state.users.map((member) =>
        member.department === "design"
          ? { ...member, groups: [...member.groups, "constructor", "toString"] }
          : member,
      ),
    };
    const prototypeRenamed = applyAction(withPrototypeNames, cell0, {
      type: "save-department",
      department: {
        ...department,
        groups: [...department.groups, "constructor-new", "toString-new"],
      },
      groupRenames: { constructor: "constructor-new", toString: "toString-new" },
    });
    expect(prototypeRenamed.catalog.services.find((service) => service.id === "prototype-service")?.subTeam).toBe("constructor-new");
    expect(prototypeRenamed.catalog.services.find((service) => service.id === "string-service")?.subTeam).toBe("toString-new");
    expect(prototypeRenamed.users.find((member) => member.department === "design")?.groups).toContain("constructor-new");
  });

  it("requires URL-safe stable IDs for managed departments and services", () => {
    const state = createSeedState();
    const cell0 = state.users.find((user) => user.department === "cell-0")!;
    expect(() => applyAction(state, cell0, {
      type: "save-department",
      department: {
        id: "not a safe id",
        name: "Unsafe",
        groups: ["Group"],
        color: "teal",
      },
    })).toThrow(/lowercase letters, numbers, and hyphens/i);
    expect(() => applyAction(state, cell0, {
      type: "save-service",
      service: {
        id: "not a safe id",
        name: "Unsafe",
        department: "sound",
        subTeam: "Sound",
      },
    })).toThrow(/lowercase letters, numbers, and hyphens/i);
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

  it("does not preserve legacy task priority when an action copies a task", () => {
    const state = createSeedState();
    const cell0 = state.users.find((user) => user.department === "cell-0")!;
    const task = state.tasks[0]!;
    const legacyState = {
      ...state,
      tasks: state.tasks.map((item) =>
        item.id === task.id ? { ...item, priority: "urgent" } : item,
      ),
    } as typeof state;

    const updated = applyAction(legacyState, cell0, {
      type: "update-task",
      taskId: task.id,
      progress: 25,
    });
    const updatedTask = updated.tasks.find((item) => item.id === task.id)!;
    expect(updatedTask.progress).toBe(25);
    expect(updatedTask).not.toHaveProperty("priority");

    const commented = applyAction(legacyState, cell0, {
      type: "add-note",
      taskId: task.id,
      text: "A note that must not restore removed data.",
    });
    expect(commented.tasks.find((item) => item.id === task.id)).not.toHaveProperty(
      "priority",
    );
  });

  it("keeps progress and status synchronized when completing or reopening tasks", () => {
    const state = createSeedState();
    const cell0 = state.users.find((user) => user.department === "cell-0")!;
    const completedTask = state.tasks.find(
      (task) => task.status === "completed",
    )!;
    const originalCompletedAt = completedTask.completedAt;
    const unchangedCompletion = applyAction(state, cell0, {
      type: "update-task",
      taskId: completedTask.id,
      status: "completed",
    });
    expect(
      unchangedCompletion.tasks.find((task) => task.id === completedTask.id),
    ).toMatchObject({
      progress: 100,
      status: "completed",
      completedAt: originalCompletedAt,
    });
    expect(
      unchangedCompletion.notifications.filter(
        (item) => item.text === `${completedTask.title} completed.`,
      ),
    ).toHaveLength(0);
    const conflicting = applyAction(unchangedCompletion, cell0, {
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
    ).toThrow(/provide a task field to update/i);
    expect(() => validateWorkspaceAction({ type: "other-action" })).toThrow(
      /valid workspace action/i,
    );
    expect(() =>
      validateWorkspaceAction({
        type: "invite-member",
        input: {
          name: "Member",
          email: "member@example.org",
          duty: "Sound operator",
          department: "sound",
          groups: ["Missing group"],
          isLeader: false,
        },
      }, createSeedState().catalog),
    ).toThrow(/groups from the selected department/i);
  });

  it("validates catalog IDs, required notes, future due dates and exact aired dates", () => {
    const validate = (input: RequestInput) => validateRequest(input, createSeedState().catalog);
    expect(() =>
      validate(freshInput({ service: "Video Editing" })),
    ).toThrow(/valid service/i);
    expect(() => validate(freshInput({ notes: "   " }))).toThrow(
      /notes are required/i,
    );
    expect(() =>
      validate(
        freshInput({ dueAt: new Date(Date.now() - 1000).toISOString() }),
      ),
    ).toThrow(/future/i);
    expect(() =>
      validate(freshInput({ dueAt: "2099-02-30T12:00:00Z" })),
    ).toThrow(/valid due date/i);
    expect(() => validate(freshInput({ dueAt: "2099-12-30" }))).toThrow(
      /valid due date/i,
    );
    expect(() =>
      validate(freshInput({ service: "previously-aired-video" })),
    ).toThrow(/aired date/i);
    expect(() =>
      validate(
        freshInput({
          service: "previously-aired-video",
          airedDates: ["2026-9-1"],
        }),
      ),
    ).toThrow(/YYYY-MM-DD/i);
    expect(() =>
      validate(
        freshInput({
          service: "previously-aired-video",
          airedDates: ["2025-02-29"],
        }),
      ),
    ).toThrow(/YYYY-MM-DD/i);
    expect(() =>
      validate(
        freshInput({
          service: "previously-aired-video",
          airedDates: ["2024-02-29"],
        }),
      ),
    ).not.toThrow();
    expect(() =>
      validate(
        freshInput({
          service: "previously-aired-video",
          airedDates: ["2099-01-01"],
        }),
      ),
    ).toThrow(/cannot be in the future/i);
    expect(() =>
      validate(
        freshInput({
          service: "previously-aired-video",
          airedDates: [new Date().toISOString().slice(0, 10)],
        }),
      ),
    ).not.toThrow();
    expect(() =>
      validate(
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
