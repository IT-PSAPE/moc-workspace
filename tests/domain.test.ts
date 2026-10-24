import { describe, expect, it, vi } from "vitest";
import {
  SERVICES,
  DEPARTMENT_COLORS,
  applyAction,
  createRequest,
  createSeedState,
  publicProjection,
  updatePublicRequest,
  validateRequest,
  validateWorkspaceAction,
} from "../packages/shared/src";
import type { RequestInput, WorkspaceAction } from "../packages/shared/src";

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
  it("keeps legacy catalog choices enabled and preserves explicit request type availability on edits", () => {
    const state = createSeedState();
    const actor = state.users.find((user) => user.department === "cell-0")!;
    expect(() => createRequest(state, freshInput())).not.toThrow();
    const created = applyAction(state, actor, {
      type: "save-service",
      service: { id: "test-service", name: "Test request type", department: "design", subTeam: "Graphic Design" },
    });
    expect(created.catalog.services.find((service) => service.id === "test-service")?.enabled).toBe(true);
    const disabled = applyAction(created, actor, {
      type: "save-service",
      service: { ...created.catalog.services.find((service) => service.id === "test-service")!, enabled: false },
    });
    const { enabled: _enabled, ...serviceInput } = disabled.catalog.services.find((service) => service.id === "test-service")!;
    const renamed = applyAction(disabled, actor, {
      type: "save-service", service: { ...serviceInput, name: "Renamed request type" },
    });
    expect(renamed.catalog.services.find((service) => service.id === "test-service")).toMatchObject({ name: "Renamed request type", enabled: false });
    expect(state.catalog.services.some((service) => service.id === "test-service")).toBe(false);
    for (const enabled of ["false", 0, 1, null, {}, []]) {
      for (const catalog of [undefined, state.catalog]) {
        expect(() => validateWorkspaceAction({ type: "save-service", service: { ...serviceInput, enabled } }, catalog)).toThrow(/availability must be true or false/i);
      }
      expect(() => validateWorkspaceAction({ type: "set-ministry-enabled", name: "Youth Ministry", enabled })).toThrow(/availability must be true or false/i);
    }
    expect(() => validateWorkspaceAction({ type: "set-ministry-enabled", name: "Youth Ministry" })).toThrow(/availability must be true or false/i);
  });

  it("rejects disabled choices for new requests while retaining a backlog request's original choices", () => {
    const { state: submitted, request } = createRequest(createSeedState(), freshInput());
    const actor = submitted.users.find((user) => user.department === "cell-0")!;
    let state = applyAction(submitted, actor, { type: "set-ministry-enabled", name: request.ministry, enabled: false });
    state = applyAction(state, actor, {
      type: "save-service",
      service: { ...state.catalog.services.find((service) => service.id === request.service)!, enabled: false },
    });
    expect(() => createRequest(state, freshInput())).toThrow(/ministry is switched off/i);
    expect(() => createRequest(state, freshInput({ ministry: "Worship" }))).toThrow(/request type is switched off/i);
    const edited = updatePublicRequest(state, request.reference, request.ministry, freshInput({ title: "Updated while unavailable" }));
    expect(edited.request.title).toBe("Updated while unavailable");
    expect(edited.request.ministry).toBe(request.ministry);
    expect(edited.request.service).toBe(request.service);

    state = applyAction(edited.state, actor, { type: "set-ministry-enabled", name: "Worship", enabled: false });
    const anotherService = state.catalog.services.find((service) => service.id !== request.service && !service.requiresAiredDates)!;
    state = applyAction(state, actor, { type: "save-service", service: { ...anotherService, enabled: false } });
    expect(() => updatePublicRequest(state, request.reference, request.ministry, freshInput({ ministry: "Worship" }))).toThrow(/ministry is switched off/i);
    expect(() => updatePublicRequest(state, request.reference, request.ministry, freshInput({ service: anotherService.id }))).toThrow(/request type is switched off/i);
    expect(() => validateRequest(freshInput(), state.catalog, { ...request, status: "approved" })).toThrow(/ministry is switched off/i);

    const approved = applyAction(state, actor, { type: "approve", requestId: request.id });
    const task = approved.tasks.find((item) => item.requestId === request.id)!;
    expect(task).toMatchObject({ department: "visual-media", subTeam: "Video", status: "pending" });
    expect(approved.requests.find((item) => item.id === request.id)?.status).toBe("approved");
    expect(() => updatePublicRequest(approved, request.reference, request.ministry, freshInput())).toThrow(/only backlog/i);
  });

  it("renames disabled ministries with their history and removes availability metadata when an unused ministry is deleted", () => {
    const { state: submitted, request } = createRequest(createSeedState(), freshInput());
    const actor = submitted.users.find((user) => user.department === "cell-0")!;
    const disabled = applyAction(submitted, actor, { type: "set-ministry-enabled", name: " youth ministry ", enabled: false });
    const renamed = applyAction(disabled, actor, { type: "save-ministry", previousName: "Youth Ministry", name: "Youth and Students" });
    expect(renamed.catalog.ministries).toContain("Youth and Students");
    expect(renamed.catalog.disabledMinistries).toEqual(["Youth and Students"]);
    expect(renamed.requests.find((item) => item.id === request.id)?.ministry).toBe("Youth and Students");
    expect(renamed.tasks.filter((task) => task.ministry === "Youth Ministry")).toHaveLength(0);
    expect(() => applyAction(renamed, actor, { type: "delete-ministry", name: "Youth and Students" })).toThrow(/switch it off instead/i);
    const created = applyAction(renamed, actor, { type: "save-ministry", name: "New ministry" });
    expect(created.catalog.disabledMinistries).not.toContain("New ministry");
    const newDisabled = applyAction(created, actor, { type: "set-ministry-enabled", name: "New ministry", enabled: false });
    const deleted = applyAction(newDisabled, actor, { type: "delete-ministry", name: "New ministry" });
    expect(deleted.catalog.ministries).not.toContain("New ministry");
    expect(deleted.catalog.disabledMinistries).toEqual(["Youth and Students"]);
    expect(() => applyAction(deleted, actor, { type: "set-ministry-enabled", name: "Missing", enabled: false })).toThrow(/not found/i);
    expect(disabled.catalog.disabledMinistries).toEqual(["Youth Ministry"]);
  });

  it("allows every public choice to be switched off and re-enabled without deleting the last stored ministry", () => {
    let state = createSeedState();
    const actor = state.users.find((user) => user.department === "cell-0")!;
    for (const name of state.catalog.ministries) {
      state = applyAction(state, actor, { type: "set-ministry-enabled", name, enabled: false });
    }
    for (const service of state.catalog.services) {
      state = applyAction(state, actor, { type: "save-service", service: { ...service, enabled: false } });
    }
    expect(state.catalog.disabledMinistries).toHaveLength(state.catalog.ministries.length);
    expect(state.catalog.services.every((service) => service.enabled === false)).toBe(true);
    expect(() => createRequest(state, freshInput())).toThrow(/switched off/i);
    state = applyAction(state, actor, { type: "set-ministry-enabled", name: "Youth Ministry", enabled: true });
    state = applyAction(state, actor, { type: "save-service", service: { ...state.catalog.services.find((service) => service.id === "social-content")!, enabled: true } });
    expect(() => createRequest(state, freshInput())).not.toThrow();
    const loneMinistry = { ...state, catalog: { ...state.catalog, ministries: ["Unused"], disabledMinistries: ["Unused"] } };
    expect(() => applyAction(loneMinistry, actor, { type: "delete-ministry", name: "Unused" })).toThrow(/at least one ministry/i);
  });

  it("deletes selected catalog choices atomically and protects choices used by historical requests or tasks", () => {
    let state = createSeedState();
    const actor = state.users.find((user) => user.department === "cell-0")!;
    for (const name of ["Unused one", "Unused two"]) {
      state = applyAction(state, actor, { type: "save-ministry", name });
      state = applyAction(state, actor, { type: "set-ministry-enabled", name, enabled: false });
    }
    for (const id of ["unused-one", "unused-two"]) {
      state = applyAction(state, actor, { type: "save-service", service: { id, name: id, department: "sound", subTeam: "Sound" } });
    }
    const before = JSON.stringify(state);
    for (const action of [
      { type: "delete-ministries", names: ["Unused one", "Youth Ministry"] },
      { type: "delete-ministries", names: ["Unused one", "Missing"] },
      { type: "delete-services", serviceIds: ["unused-one", "social-content"] },
      { type: "delete-services", serviceIds: ["unused-one", "missing"] },
    ] as WorkspaceAction[]) {
      expect(() => applyAction(state, actor, action)).toThrow(/switch it off instead|not found/i);
      expect(JSON.stringify(state)).toBe(before);
    }
    const withoutMinistries = applyAction(state, actor, { type: "delete-ministries", names: ["Unused one", "Unused two"] });
    expect(withoutMinistries.catalog.ministries).not.toContain("Unused one");
    expect(withoutMinistries.catalog.ministries).not.toContain("Unused two");
    expect(withoutMinistries.catalog.disabledMinistries).toEqual([]);
    const withoutServices = applyAction(withoutMinistries, actor, { type: "delete-services", serviceIds: ["unused-one", "unused-two"] });
    expect(withoutServices.catalog.services.some((service) => service.id.startsWith("unused-"))).toBe(false);
    expect(withoutServices.requests).toBe(state.requests);
    expect(withoutServices.tasks).toBe(state.tasks);
    const oneRemaining = { ...state, catalog: { ...state.catalog, ministries: ["Unused one", "Unused two"] } };
    expect(() => applyAction(oneRemaining, actor, { type: "delete-ministries", names: ["Unused one", "Unused two"] })).toThrow(/at least one ministry/i);
    expect(oneRemaining.catalog.ministries).toEqual(["Unused one", "Unused two"]);
  });

  it("validates catalog bulk selections and requires approved leader access to manage availability", () => {
    for (const [type, key] of [["delete-services", "serviceIds"], ["delete-ministries", "names"]] as const) {
      for (const values of [undefined, null, [], [""], ["one", "one"], ["one", null], Array.from({ length: 101 }, (_, index) => `item-${index}`)]) {
        expect(() => validateWorkspaceAction({ type, [key]: values })).toThrow();
      }
    }
    expect(() => validateWorkspaceAction({ type: "delete-ministries", names: ["Youth Ministry", " youth ministry "] })).toThrow(/only once/i);
    const state = createSeedState();
    const member = { ...state.users.find((user) => user.department !== "cell-0")!, isLeader: false };
    const memberState = { ...state, users: state.users.map((user) => user.id === member.id ? member : user) };
    expect(() => applyAction(memberState, member, { type: "set-ministry-enabled", name: "Youth Ministry", enabled: false })).toThrow(/approved leader/i);
  });

  it("accepts every department color preset and rejects unsupported colors", () => {
    const state = createSeedState();
    const actor = state.users.find((user) => user.department === "cell-0")!;
    const department = state.catalog.departments.find((item) => item.id === "design")!;
    for (const color of DEPARTMENT_COLORS) {
      const next = applyAction(state, actor, { type: "save-department", department: { ...department, color } });
      expect(next.catalog.departments.find((item) => item.id === department.id)?.color).toBe(color);
    }
    expect(() => validateWorkspaceAction({ type: "save-department", department: { ...department, color: "unsupported" } }, state)).toThrow(/valid department color/i);
  });

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

  it("records receipt in backlog and preserves it through public edits", () => {
    const { state, request } = createRequest(createSeedState(), freshInput());
    expect(request.status).toBe("backlog");
    expect(request.lifecycle).toEqual({ receivedAt: request.createdAt });
    const edited = updatePublicRequest(state, request.reference, request.ministry, freshInput({ title: "Revised brief" }));
    expect(edited.request.lifecycle).toEqual(request.lifecycle);
    expect(edited.request.lifecycle).not.toBe(request.lifecycle);
  });

  it("copies original aired dates into the approved task brief", () => {
    const airedDates = [new Date(Date.now() - 86400000).toISOString().slice(0, 10)];
    const submitted = createRequest(createSeedState(), freshInput({ service: "previously-aired-video", airedDates }));
    const cell0 = submitted.state.users.find((user) => user.department === "cell-0")!;
    const approved = applyAction(submitted.state, cell0, { type: "approve", requestId: submitted.request.id });
    const task = approved.tasks.find((item) => item.requestId === submitted.request.id)!;
    expect(task.airedDates).toEqual(airedDates);
    expect(task.airedDates).not.toBe(submitted.request.airedDates);
  });

  it("limits request decisions to approved Cell 0 leaders", () => {
    const { state, request } = createRequest(createSeedState(), freshInput());
    const departmentLeader = state.users.find((user) => user.department === "design")!;
    const cell0 = state.users.find((user) => user.department === "cell-0")!;
    const regularMemberState = { ...state, users: state.users.map((user) => user.id === cell0.id ? { ...user, isLeader: false } : user) };
    for (const action of [
      { type: "approve", requestId: request.id },
      { type: "reject", requestId: request.id, reason: "Needs clarification." },
    ] as const) {
      expect(() => applyAction(state, departmentLeader, action)).toThrow(/only an approved Cell 0 leader/i);
      expect(() => applyAction(regularMemberState, cell0, action)).toThrow(/only an approved Cell 0 leader/i);
    }
  });

  it("allows a rejected request to be approved once, retaining its recorded rejection", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-10-01T09:00:00.000Z"));
      const { state, request } = createRequest(createSeedState(), freshInput());
      const cell0 = state.users.find((user) => user.department === "cell-0")!;
      vi.setSystemTime(new Date("2026-10-02T10:00:00.000Z"));
      const rejected = applyAction(state, cell0, { type: "reject", requestId: request.id, reason: "Needs clarification." });
      expect(rejected.requests.find((item) => item.id === request.id)?.lifecycle).toEqual({
        receivedAt: "2026-10-01T09:00:00.000Z",
        rejectedAt: "2026-10-02T10:00:00.000Z",
      });
      expect(rejected.tasks.some((task) => task.requestId === request.id)).toBe(false);
      expect(() => applyAction(rejected, cell0, { type: "reject", requestId: request.id, reason: "Again" })).toThrow(/only backlog/i);
      vi.setSystemTime(new Date("2026-10-03T11:00:00.000Z"));
      const approved = applyAction(rejected, cell0, { type: "approve", requestId: request.id });
      const recovered = approved.requests.find((item) => item.id === request.id)!;
      const tasks = approved.tasks.filter((task) => task.requestId === request.id);
      expect(recovered.status).toBe("approved");
      expect(recovered.lifecycle).toEqual({
        receivedAt: "2026-10-01T09:00:00.000Z",
        rejectedAt: "2026-10-02T10:00:00.000Z",
        approvedAt: "2026-10-03T11:00:00.000Z",
      });
      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toMatchObject({ status: "pending", lifecycle: recovered.lifecycle, createdAt: recovered.lifecycle?.approvedAt });
      expect(tasks[0].lifecycle).not.toBe(recovered.lifecycle);
      expect(() => applyAction(approved, cell0, { type: "approve", requestId: request.id })).toThrow(/only backlog or rejected/i);
      expect(() => applyAction(approved, cell0, { type: "reject", requestId: request.id, reason: "Again" })).toThrow(/only backlog/i);
      const inconsistent = { ...approved, requests: approved.requests.map((item) => item.id === request.id ? { ...item, status: "rejected" as const, taskId: undefined } : item) };
      expect(() => applyAction(inconsistent, cell0, { type: "approve", requestId: request.id })).toThrow(/already has an assigned task/i);
    } finally {
      vi.useRealTimers();
    }
  });

  it("records first task milestones across backmoves and shares them with its request", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-10-01T09:00:00.000Z"));
      const submitted = createRequest(createSeedState(), freshInput());
      const cell0 = submitted.state.users.find((user) => user.department === "cell-0")!;
      vi.setSystemTime(new Date("2026-10-02T09:00:00.000Z"));
      let state = applyAction(submitted.state, cell0, { type: "approve", requestId: submitted.request.id });
      const taskId = state.requests.find((request) => request.id === submitted.request.id)!.taskId!;
      const initialLifecycle = state.tasks.find((task) => task.id === taskId)!.lifecycle;
      vi.setSystemTime(new Date("2026-10-03T09:00:00.000Z"));
      state = applyAction(state, cell0, { type: "update-task", taskId, status: "pending" });
      expect(state.tasks.find((task) => task.id === taskId)?.lifecycle).toEqual(initialLifecycle);
      state = applyAction(state, cell0, { type: "update-task", taskId, status: "in-progress" });
      vi.setSystemTime(new Date("2026-10-04T09:00:00.000Z"));
      state = applyAction(state, cell0, { type: "update-task", taskId, status: "completed" });
      const lifecycle = {
        receivedAt: "2026-10-01T09:00:00.000Z",
        approvedAt: "2026-10-02T09:00:00.000Z",
        inProgressAt: "2026-10-03T09:00:00.000Z",
        completedAt: "2026-10-04T09:00:00.000Z",
      };
      vi.setSystemTime(new Date("2026-10-05T09:00:00.000Z"));
      for (const status of ["pending", "in-progress", "completed"] as const) {
        state = applyAction(state, cell0, { type: "update-task", taskId, status });
        expect(state.tasks.find((task) => task.id === taskId)?.lifecycle).toEqual(lifecycle);
        expect(state.requests.find((request) => request.id === submitted.request.id)?.lifecycle).toEqual(lifecycle);
      }
      const tracked = publicProjection(state, submitted.request.reference, submitted.request.ministry)!;
      expect(tracked.task?.lifecycle).toEqual(lifecycle);
      expect(tracked.task).not.toHaveProperty("completedAt");
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves unknown legacy milestones blank and stamps only observed transitions", () => {
    const initial = createSeedState();
    const cell0 = initial.users.find((user) => user.department === "cell-0")!;
    const request = initial.requests.find((item) => item.status === "backlog")!;
    const legacy = { ...initial, requests: initial.requests.map((item) => item.id === request.id ? { ...item, lifecycle: undefined } : item) };
    const approved = applyAction(legacy, cell0, { type: "approve", requestId: request.id });
    const task = approved.tasks.find((item) => item.requestId === request.id)!;
    expect(task.lifecycle?.approvedAt).toBeTruthy();
    expect(task.lifecycle?.receivedAt).toBeUndefined();
    const completed = applyAction(approved, cell0, { type: "update-task", taskId: task.id, status: "completed" });
    expect(completed.tasks.find((item) => item.id === task.id)?.lifecycle).toEqual({ approvedAt: task.lifecycle?.approvedAt, completedAt: expect.any(String) });
    const missingCompleted = { ...completed, tasks: completed.tasks.map((item) => item.id === task.id ? { ...item, lifecycle: undefined } : item) };
    const unchanged = applyAction(missingCompleted, cell0, { type: "update-task", taskId: task.id, status: "completed" });
    expect(unchanged.tasks.find((item) => item.id === task.id)?.lifecycle).toBeUndefined();
    expect(unchanged.activities).toEqual(missingCompleted.activities);
    expect(unchanged.notifications).toEqual(missingCompleted.notifications);
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
        status: "in-progress",
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
      status: "in-progress",
    });
    expect(edited.tasks.find((task) => task.id === ownTask.id)?.status).toBe("in-progress");
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
        { type: "update-task", taskId: ownTask.id, status: "in-progress" },
      ),
    ).toThrow(/not been approved/i);
    expect(() =>
      applyAction(
        {
          ...state,
          users: state.users.filter((item) => item.id !== leader.id),
        },
        leader,
        { type: "update-task", taskId: ownTask.id, status: "in-progress" },
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

  it("validates bounded, unique selections for every bulk action", () => {
    const catalog = createSeedState().catalog;
    for (const ids of [undefined, null, [], [""], [" "], [1], Array(1), ["same", "same"], Array.from({ length: 101 }, (_, index) => `id-${index}`)]) {
      for (const action of [
        { type: "delete-members", userIds: ids },
        { type: "move-members", userIds: ids, department: "sound", groups: ["Sound"] },
        { type: "delete-departments", departmentIds: ids },
      ]) expect(() => validateWorkspaceAction(action, catalog)).toThrow();
    }
    expect(() => validateWorkspaceAction({ type: "move-members", userIds: ["member"], department: "sound", groups: ["Video"] }, catalog)).toThrow(/groups from the selected department/i);
    expect(() => validateWorkspaceAction({ type: "move-members", userIds: ["member"], department: "missing", groups: ["Sound"] }, catalog)).toThrow(/valid department/i);
    const maximumSelection = Array.from({ length: 100 }, (_, index) => `id-${index}`);
    for (const action of [
      { type: "delete-members", userIds: maximumSelection },
      { type: "move-members", userIds: maximumSelection, department: "sound", groups: ["Sound"] },
      { type: "delete-departments", departmentIds: maximumSelection },
    ]) {
      expect(() => validateWorkspaceAction(action, catalog)).not.toThrow();
      expect(() => validateWorkspaceAction(action)).not.toThrow();
    }
    for (const groups of [undefined, [], [""], [null], [1], Array(1), ["Sound", "Sound"]]) {
      const action = { type: "move-members", userIds: ["member"], department: "sound", groups };
      expect(() => validateWorkspaceAction(action, catalog)).toThrow();
      expect(() => validateWorkspaceAction(action)).toThrow();
    }
  });

  it("restricts bulk member and department actions to approved Cell 0 leaders", () => {
    const state = createSeedState();
    const cell0 = state.users.find((user) => user.department === "cell-0")!;
    const otherLeader = state.users.find((user) => user.department === "design")!;
    const ordinaryCell0 = { ...state, users: state.users.map((user) => user.id === cell0.id ? { ...user, isLeader: false } : user) };
    const actions: WorkspaceAction[] = [
      { type: "delete-members", userIds: [otherLeader.id] },
      { type: "move-members", userIds: [otherLeader.id], department: "sound", groups: ["Sound"] },
      { type: "delete-departments", departmentIds: ["design"] },
    ];
    for (const action of actions) {
      expect(() => applyAction(state, otherLeader, action)).toThrow(/only an approved Cell 0 leader/i);
      expect(() => applyAction(ordinaryCell0, cell0, action)).toThrow(/only an approved Cell 0 leader/i);
    }
  });

  it("deletes selected members together while retaining notes and audit history", () => {
    const initial = createSeedState();
    const cell0 = initial.users.find((user) => user.department === "cell-0")!;
    const design = initial.users.find((user) => user.department === "design")!;
    const sound = initial.users.find((user) => user.department === "sound")!;
    const ownTask = initial.tasks.find((task) => task.department === design.department)!;
    const state = applyAction(initial, design, { type: "add-note", taskId: ownTask.id, text: "Retain this comment after removing its author." });
    const snapshot = structuredClone(state);
    for (const userIds of [[design.id, "missing"], [design.id, cell0.id]]) {
      expect(() => applyAction(state, cell0, { type: "delete-members", userIds })).toThrow();
      expect(state).toEqual(snapshot);
    }
    const deleted = applyAction(state, cell0, { type: "delete-members", userIds: [design.id, sound.id] });
    expect(deleted.users).toHaveLength(state.users.length - 2);
    expect(deleted.users.some((user) => [design.id, sound.id].includes(user.id))).toBe(false);
    expect(deleted.users.find((user) => user.id === cell0.id)).toEqual(cell0);
    expect(deleted.tasks).toBe(state.tasks);
    expect(deleted.requests).toBe(state.requests);
    expect(deleted.notifications).toBe(state.notifications);
    expect(deleted.activities.slice(0, state.activities.length)).toEqual(state.activities);
    expect(deleted.tasks.find((task) => task.id === ownTask.id)?.privateNotes.at(-1)).toMatchObject({ author: design.name, text: "Retain this comment after removing its author." });
    expect(() => applyAction(deleted, design, { type: "read-notifications" })).toThrow(/access has not been approved/i);
    expect(state).toEqual(snapshot);
  });

  it("moves selected members atomically without changing their duties, access, or work", () => {
    const state = createSeedState();
    const cell0 = state.users.find((user) => user.department === "cell-0")!;
    const selected = state.users.filter((user) => ["design", "visual-media"].includes(user.department));
    const userIds = selected.map((user) => user.id);
    const snapshot = structuredClone(state);
    for (const invalid of [
      { userIds: [userIds[0], "missing"], department: "sound", groups: ["Sound"] },
      { userIds: [userIds[0], cell0.id], department: "sound", groups: ["Sound"] },
      { userIds, department: "sound", groups: ["Video"] },
      { userIds, department: "missing", groups: ["Sound"] },
    ]) {
      expect(() => applyAction(state, cell0, { type: "move-members", ...invalid })).toThrow();
      expect(state).toEqual(snapshot);
    }
    const moved = applyAction(state, cell0, { type: "move-members", userIds, department: "sound", groups: ["Sound"] });
    for (const original of selected) {
      expect(moved.users.find((user) => user.id === original.id)).toEqual({ ...original, department: "sound", groups: ["Sound"] });
    }
    expect(moved.users.find((user) => user.id === cell0.id)).toEqual(cell0);
    expect(moved.tasks).toBe(state.tasks);
    expect(moved.requests).toBe(state.requests);
    expect(moved.activities.slice(0, state.activities.length)).toEqual(state.activities);
    expect(state).toEqual(snapshot);
  });

  it("deletes only unused departments and never partially applies a bulk deletion", () => {
    const initial = createSeedState();
    const cell0 = initial.users.find((user) => user.department === "cell-0")!;
    let state = initial;
    for (const id of ["unused-one", "unused-two"]) state = applyAction(state, cell0, { type: "save-department", department: { id, name: id, groups: ["General"], color: "teal" } });
    const snapshot = structuredClone(state);
    for (const departmentIds of [["unused-one", "missing"], ["unused-one", "cell-0"], ["unused-one", "sound"]]) {
      expect(() => applyAction(state, cell0, { type: "delete-departments", departmentIds })).toThrow();
      expect(state).toEqual(snapshot);
    }
    const deleted = applyAction(state, cell0, { type: "delete-departments", departmentIds: ["unused-one", "unused-two"] });
    expect(deleted.catalog.departments).toEqual(initial.catalog.departments);
    expect(deleted.users).toBe(state.users);
    expect(deleted.tasks).toBe(state.tasks);
    expect(deleted.requests).toBe(state.requests);
    expect(deleted.activities).toBe(state.activities);
    expect(state).toEqual(snapshot);
  });

  it("protects a bulk department selection when any member, service, or task still uses it", () => {
    let base = createSeedState();
    const cell0 = base.users.find((user) => user.department === "cell-0")!;
    for (const id of ["unused", "referenced"]) {
      base = applyAction(base, cell0, {
        type: "save-department",
        department: { id, name: id, groups: ["General"], color: "teal" },
      });
    }
    const states = [
      {
        ...base,
        users: [...base.users, { ...base.users[0], id: "member-reference", department: "referenced", groups: ["General"] }],
      },
      {
        ...base,
        tasks: [...base.tasks, { ...base.tasks[0], id: "task-reference", department: "referenced", subTeam: "General" }],
      },
      {
        ...base,
        catalog: {
          ...base.catalog,
          services: [...base.catalog.services, { ...base.catalog.services[0], id: "service-reference", department: "referenced", subTeam: "General" }],
        },
      },
    ];
    for (const state of states) {
      const snapshot = structuredClone(state);
      expect(() => applyAction(state, cell0, {
        type: "delete-departments",
        departmentIds: ["unused", "referenced"],
      })).toThrow(/reassign members, services, and tasks/i);
      expect(state).toEqual(snapshot);
    }
  });

  it("creates and assigns new member groups atomically and reuses case-insensitive matches", () => {
    const state = createSeedState();
    const cell0 = state.users.find((user) => user.department === "cell-0")!;
    const member = state.users.find((user) => user.department === "design")!;

    const created = applyAction(state, cell0, {
      type: "update-member",
      userId: member.id,
      changes: {
        duty: "Motion designer",
        groups: ["Graphic Design", "Motion Lab"],
      },
      createGroups: ["  Motion Lab  "],
    });
    expect(created.catalog.departments.find((item) => item.id === "design")?.groups)
      .toContain("Motion Lab");
    expect(created.users.find((item) => item.id === member.id)).toMatchObject({
      duty: "Motion designer",
      groups: ["Graphic Design", "Motion Lab"],
    });
    expect(state.catalog.departments.find((item) => item.id === "design")?.groups)
      .not.toContain("Motion Lab");
    expect(state.users.find((item) => item.id === member.id)?.groups)
      .not.toContain("Motion Lab");

    const deduplicated = applyAction(created, cell0, {
      type: "update-member",
      userId: member.id,
      changes: { groups: ["graphic design"] },
      createGroups: ["GRAPHIC DESIGN"],
    });
    const design = deduplicated.catalog.departments.find((item) => item.id === "design")!;
    expect(design.groups.filter((group) => group.toLocaleLowerCase() === "graphic design"))
      .toEqual(["Graphic Design"]);
    expect(deduplicated.users.find((item) => item.id === member.id)?.groups)
      .toEqual(["Graphic Design"]);

    expect(() => applyAction(state, cell0, {
      type: "update-member",
      userId: member.id,
      changes: { groups: ["Graphic Design"] },
      createGroups: ["Unassigned Group"],
    })).toThrow(/select every new group/i);
    expect(() => applyAction(state, cell0, {
      type: "update-member",
      userId: member.id,
      changes: { groups: ["Graphic Design", "graphic design"] },
      createGroups: ["Graphic Design"],
    })).toThrow(/selected once/i);
    expect(() => applyAction(state, cell0, {
      type: "update-member",
      userId: member.id,
      changes: { groups: ["Graphic Design", "New Group"] },
      createGroups: ["New Group", " new group "],
    })).toThrow(/unique/i);
    expect(() => applyAction(state, cell0, {
      type: "update-member",
      userId: member.id,
      changes: { groups: [...member.groups, ...Array.from({ length: 21 }, (_, index) => `Group ${index}`)] },
      createGroups: Array.from({ length: 21 }, (_, index) => `Group ${index}`),
    })).toThrow(/up to 20/i);
    expect(() => applyAction(state, cell0, {
      type: "update-member",
      userId: member.id,
      changes: { groups: [...member.groups, "x".repeat(121)] },
      createGroups: ["x".repeat(121)],
    })).toThrow(/between 1 and 120/i);
    expect(() => applyAction(state, cell0, {
      type: "update-member",
      userId: member.id,
      changes: { groups: member.groups },
      createGroups: ["   "],
    })).toThrow(/between 1 and 120/i);
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
        department: "visual-media",
      }),
    );
    expect(result.task).not.toHaveProperty("progress");
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
      lifecycle: { receivedAt: "1999-01-01T00:00:00.000Z", approvedAt: "1999-01-01T00:00:00.000Z" },
    });
    const { state, request } = createRequest(createSeedState(), injected);
    expect(request).not.toHaveProperty("privateNotes");
    expect(request).not.toHaveProperty("trackingCodeHash");
    expect(request.taskId).toBeUndefined();
    expect(request.id).not.toBe("forged-request-id");
    expect(request.reference).not.toBe("MOC-2099-9999");
    expect(request.lifecycle).toEqual({ receivedAt: request.createdAt });
    expect(
      publicProjection(state, request.reference, request.ministry)?.task,
    ).toBeNull();
  });

  it("sets completion timestamps when task status becomes completed", () => {
    const state = createSeedState();
    const user = state.users.find(
      (item) => item.department === "visual-media",
    )!;
    const task = state.tasks.find(
      (item) => item.department === user.department && item.status !== "completed",
    )!;
    const updated = applyAction(state, user, {
      type: "update-task",
      taskId: task.id,
      status: "completed",
    });
    const completed = updated.tasks.find((item) => item.id === task.id)!;
    expect(completed.status).toBe("completed");
    expect(completed.lifecycle?.completedAt).toBeTruthy();
  });

  it("does not preserve removed legacy task fields when an action copies a task", () => {
    const state = createSeedState();
    const cell0 = state.users.find((user) => user.department === "cell-0")!;
    const task = state.tasks[0]!;
    const legacyState = {
      ...state,
      tasks: state.tasks.map((item) =>
        item.id === task.id
          ? { ...item, priority: "urgent", progress: 50 }
          : item,
      ),
    } as typeof state;

    const updated = applyAction(legacyState, cell0, {
      type: "update-task",
      taskId: task.id,
      status: "in-progress",
    });
    const updatedTask = updated.tasks.find((item) => item.id === task.id)!;
    expect(updatedTask).not.toHaveProperty("priority");
    expect(updatedTask).not.toHaveProperty("progress");

    const commented = applyAction(legacyState, cell0, {
      type: "add-note",
      taskId: task.id,
      text: "A note that must not restore removed data.",
    });
    expect(commented.tasks.find((item) => item.id === task.id)).not.toHaveProperty(
      "priority",
    );
    expect(commented.tasks.find((item) => item.id === task.id)).not.toHaveProperty(
      "progress",
    );
  });

  it("updates task status, completion timestamps, activities and notifications", () => {
    const state = createSeedState();
    const cell0 = state.users.find((user) => user.department === "cell-0")!;
    const completedTask = state.tasks.find(
      (task) => task.status === "completed",
    )!;
    const originalCompletedAt = completedTask.lifecycle?.completedAt;
    const unchangedCompletion = applyAction(state, cell0, {
      type: "update-task",
      taskId: completedTask.id,
      status: "completed",
    });
    expect(
      unchangedCompletion.tasks.find((task) => task.id === completedTask.id),
    ).toMatchObject({
      status: "completed",
      lifecycle: { completedAt: originalCompletedAt },
    });
    expect(unchangedCompletion.tasks.find((task) => task.id === completedTask.id))
      .not.toHaveProperty("progress");
    expect(
      unchangedCompletion.notifications.filter(
        (item) => item.text === `${completedTask.title} completed.`,
      ),
    ).toHaveLength(0);
    const backInProgress = applyAction(unchangedCompletion, cell0, {
      type: "update-task",
      taskId: completedTask.id,
      status: "in-progress",
    });
    expect(
      backInProgress.tasks.find((task) => task.id === completedTask.id),
    ).toMatchObject({ status: "in-progress" });
    expect(
      backInProgress.tasks.find((task) => task.id === completedTask.id)
        ?.lifecycle?.completedAt,
    ).toBe(originalCompletedAt);
    const pending = applyAction(backInProgress, cell0, {
      type: "update-task",
      taskId: completedTask.id,
      status: "pending",
    });
    expect(
      pending.tasks.find((task) => task.id === completedTask.id),
    ).toMatchObject({ status: "pending" });
    const priorCompletionActivities = pending.activities.filter(
      (item) => item.type === "completed" && item.taskId === completedTask.id,
    ).length;
    const priorStatusActivities = pending.activities.filter(
      (item) => item.type === "status" && item.taskId === completedTask.id,
    ).length;
    const newlyCompleted = applyAction(pending, cell0, {
      type: "update-task",
      taskId: completedTask.id,
      status: "completed",
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
    ).toHaveLength(priorCompletionActivities + 2);
    expect(
      newlyCompleted.activities.filter(
        (item) => item.type === "status" && item.taskId === completedTask.id,
      ),
    ).toHaveLength(priorStatusActivities);
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
        progress: 100,
        status: "completed",
      }),
    ).toThrow(/percentage progress is no longer supported/i);
    expect(() =>
      validateWorkspaceAction({
        type: "update-task",
        taskId: "t1",
        status: "broken",
      }),
    ).toThrow(/valid task status/i);
    expect(() =>
      validateWorkspaceAction({
        type: "update-task",
        taskId: "t1",
        priority: "critical",
      }),
    ).toThrow(/provide a task status to update/i);
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
  it("allows a public edit only while in backlog and preserves the MOC reference", () => {
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
    expect(edited.request.status).toBe("backlog");
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
    ).toThrow(/only backlog/i);
  });
});
