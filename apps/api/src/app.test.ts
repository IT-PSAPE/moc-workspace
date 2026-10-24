import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApiApp } from "./index";
import { JsonRepository } from "./repository";
import { createSeedState, type WorkspaceState } from "@moc/shared";

process.env.DEMO_MODE = "true";

const temporaryDirectories: string[] = [];

async function makeApp(options: Parameters<typeof createApiApp>[1] = {}) {
  const directory = await mkdtemp(join(tmpdir(), "moc-api-"));
  temporaryDirectories.push(directory);
  return createApiApp(
    new JsonRepository(join(directory, "state.json")),
    options,
  );
}

async function makeBulkActionHarness() {
  const directory = await mkdtemp(join(tmpdir(), "moc-api-bulk-"));
  temporaryDirectories.push(directory);
  const statePath = join(directory, "state.json");
  const repository = new JsonRepository(statePath);
  const app = createApiApp(repository);
  const login = async (department: string) => {
    const response = await app.request("/api/auth/demo", {
      method: "POST",
      headers: { origin: "http://localhost:5173", "content-type": "application/json" },
      body: JSON.stringify({ department }),
    });
    expect(response.status).toBe(200);
    return response.headers.get("set-cookie")!.split(";")[0]!;
  };
  const action = (cookie: string, payload: unknown) => app.request("/api/actions", {
    method: "POST",
    headers: { origin: "http://localhost:5173", "content-type": "application/json", cookie },
    body: JSON.stringify(payload),
  });
  return { app, repository, statePath, login, action };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("MOC API", () => {
  it("persists public option availability while preserving existing request edits and tracking", async () => {
    const { app, repository, statePath, login, action } = await makeBulkActionHarness();
    const cookie = await login("sound");
    const headers = { origin: "http://localhost:5174", "content-type": "application/json" };
    const input = {
      ministry: "Youth Ministry", service: "social-content", title: "Availability history",
      instructions: "Prepare a recap.", notes: "Use the existing brief.",
      dueAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    };
    const created = await app.request("/api/requests", {
      method: "POST", headers, body: JSON.stringify(input),
    });
    expect(created.status).toBe(201);
    const receipt = await created.json() as {
      request: { id: string; reference: string }; trackingCode: string;
    };
    const before = await repository.read();
    const service = before.catalog.services.find(({ id }) => id === input.service)!;
    expect((await action(cookie, {
      type: "set-ministry-enabled", name: input.ministry, enabled: false,
    })).status).toBe(200);
    expect((await action(cookie, {
      type: "save-service", service: { ...service, enabled: false },
    })).status).toBe(200);

    const publicCatalog = await (await app.request("/api/catalog")).json() as {
      ministries: string[]; disabledMinistries: string[];
      services: Array<{ id: string; name: string; enabled?: boolean }>;
    };
    expect(publicCatalog.ministries).toContain(input.ministry);
    expect(publicCatalog.disabledMinistries).toContain(input.ministry);
    expect(publicCatalog.services.find(({ id }) => id === input.service))
      .toMatchObject({ id: service.id, name: service.name, enabled: false });

    for (const candidate of [input, { ...input, ministry: "Sunday Services" },
      { ...input, service: "video-creation" }]) {
      const rejected = await app.request("/api/requests", {
        method: "POST", headers, body: JSON.stringify(candidate),
      });
      expect(rejected.status).toBe(400);
      expect(await rejected.json()).toMatchObject({ error: expect.any(String) });
    }
    expect((await repository.read()).requests).toEqual(before.requests);

    const edited = await app.request("/api/requests", {
      method: "PATCH", headers,
      body: JSON.stringify({ code: receipt.trackingCode, input: { ...input, title: "Revised existing brief" } }),
    });
    expect(edited.status).toBe(200);
    expect(await edited.json()).toMatchObject({
      title: "Revised existing brief", ministry: input.ministry, service: input.service,
    });
    const tracked = await app.request("/api/track", {
      method: "POST", headers, body: JSON.stringify({ code: receipt.trackingCode }),
    });
    expect(tracked.status).toBe(200);
    expect(await tracked.json()).toMatchObject({
      request: { reference: receipt.request.reference, ministry: input.ministry, service: input.service },
    });

    expect((await action(cookie, {
      type: "set-ministry-enabled", name: "Sunday Services", enabled: false,
    })).status).toBe(200);
    const changedDisabledSelection = await app.request("/api/requests", {
      method: "PATCH", headers,
      body: JSON.stringify({ code: receipt.trackingCode, input: { ...input, ministry: "Sunday Services" } }),
    });
    expect(changedDisabledSelection.status).toBe(400);
    const reloaded = await new JsonRepository(statePath).read();
    expect(reloaded.catalog.disabledMinistries).toEqual(expect.arrayContaining([input.ministry, "Sunday Services"]));
    expect(reloaded.catalog.services.find(({ id }) => id === input.service)?.enabled).toBe(false);
    expect(reloaded.requests.find(({ id }) => id === receipt.request.id)?.ministry).toBe(input.ministry);
    expect((await action(cookie, {
      type: "set-ministry-enabled", name: input.ministry, enabled: true,
    })).status).toBe(200);
    expect((await action(cookie, {
      type: "save-service", service: { ...service, enabled: true },
    })).status).toBe(200);
    expect((await app.request("/api/requests", {
      method: "POST", headers, body: JSON.stringify(input),
    })).status).toBe(201);
  });

  it("rejects invalid public option availability and catalog actions by nonleaders atomically", async () => {
    const { repository, login, action } = await makeBulkActionHarness();
    const cookie = await login("sound");
    const initial = await repository.read();
    const service = initial.catalog.services[0]!;
    for (const payload of [
      { type: "set-ministry-enabled", name: "Unknown ministry", enabled: false },
      { type: "set-ministry-enabled", name: "Youth Ministry", enabled: "false" },
      { type: "set-ministry-enabled", name: "Youth Ministry", enabled: null },
      { type: "save-service", service: { ...service, enabled: "false" } },
      { type: "save-service", service: { ...service, enabled: null } },
    ]) {
      expect((await action(cookie, payload)).status).toBe(400);
      expect(await repository.read()).toEqual(initial);
    }
    await repository.update((state) => ({
      ...state,
      users: state.users.map((member) => member.department === "sound"
        ? { ...member, isLeader: false }
        : member),
    }));
    const nonleaderState = await repository.read();
    for (const payload of [
      { type: "save-ministry", name: "Unauthorised Ministry" },
      { type: "set-ministry-enabled", name: "Youth Ministry", enabled: false },
      { type: "save-service", service: { ...service, enabled: false } },
      { type: "delete-ministries", names: ["Youth Ministry"] },
      { type: "delete-services", serviceIds: [service.id] },
    ]) {
      expect((await action(cookie, payload)).status).toBe(400);
      expect(await repository.read()).toEqual(nonleaderState);
    }
  });

  it("deletes a selected set of unused public options atomically and protects request history", async () => {
    const { repository, statePath, login, action } = await makeBulkActionHarness();
    const cookie = await login("sound");
    const names = ["Unused Alpha Ministry", "Unused Beta Ministry"];
    const serviceIds = ["unused-alpha-type", "unused-beta-type"];
    for (const name of names)
      expect((await action(cookie, { type: "save-ministry", name })).status).toBe(200);
    for (const [index, id] of serviceIds.entries())
      expect((await action(cookie, {
        type: "save-service", service: {
          id, name: `Unused type ${index}`, department: "sound", subTeam: "Sound", enabled: false,
        },
      })).status).toBe(200);
    expect((await action(cookie, { type: "set-ministry-enabled", name: names[0], enabled: false })).status).toBe(200);
    const initial = await repository.read();
    const usedServiceId = initial.requests[0]!.service;
    const usedMinistry = initial.requests[0]!.ministry;
    for (const payload of [
      { type: "delete-ministries", names: [names[0], "Missing ministry"] },
      { type: "delete-ministries", names: [names[0], usedMinistry] },
      { type: "delete-ministries", names: [names[0], names[0]] },
      { type: "delete-ministries", names: [] },
      { type: "delete-ministries", names: Array.from({ length: 101 }, (_, index) => `Ministry ${index}`) },
      { type: "delete-services", serviceIds: [serviceIds[0], "missing-type"] },
      { type: "delete-services", serviceIds: [serviceIds[0], usedServiceId] },
      { type: "delete-services", serviceIds: [serviceIds[0], serviceIds[0]] },
      { type: "delete-services", serviceIds: [] },
      { type: "delete-services", serviceIds: Array.from({ length: 101 }, (_, index) => `type-${index}`) },
    ]) {
      expect((await action(cookie, payload)).status).toBe(400);
      expect(await repository.read()).toEqual(initial);
    }
    expect((await action(cookie, { type: "delete-ministries", names })).status).toBe(200);
    expect((await action(cookie, { type: "delete-services", serviceIds })).status).toBe(200);
    const reloaded = await new JsonRepository(statePath).read();
    expect(reloaded.catalog.ministries.some((name) => names.includes(name))).toBe(false);
    expect(reloaded.catalog.disabledMinistries ?? []).not.toContain(names[0]);
    expect(reloaded.catalog.services.some(({ id }) => serviceIds.includes(id))).toBe(false);
    expect(reloaded.requests).toEqual(initial.requests);
    expect(reloaded.tasks).toEqual(initial.tasks);
  });

  it("requires Cell 0 leadership for every bulk settings action", async () => {
    const { repository, login, action } = await makeBulkActionHarness();
    const cookie = await login("cell-0");
    await repository.update((state) => ({
      ...state,
      users: state.users.map((member) => member.department === "cell-0"
        ? { ...member, isLeader: false }
        : member),
      catalog: { ...state.catalog, departments: [...state.catalog.departments,
        { id: "unused", name: "Unused", groups: ["General"], color: "blue" },
      ] },
    }));
    const before = await repository.read();
    const memberId = before.users.find((member) => member.department === "sound")!.id;
    for (const payload of [
      { type: "delete-members", userIds: [memberId] },
      { type: "move-members", userIds: [memberId], department: "visual-media", groups: ["Video"] },
      { type: "delete-departments", departmentIds: ["unused"] },
    ]) {
      const response = await action(cookie, payload);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: expect.stringMatching(/Cell 0 leader/i) });
      expect(await repository.read()).toEqual(before);
    }
  });

  it("moves a member selection atomically with Cell 0 leader access and a valid destination", async () => {
    const { repository, statePath, login, action } = await makeBulkActionHarness();
    const cell0Cookie = await login("cell-0");
    const soundCookie = await login("sound");
    const initial = await repository.read();
    const actor = initial.users.find((member) => member.department === "cell-0")!;
    const selected = initial.users.filter((member) => member.department === "design").map(({ id }) => id);
    expect(selected).toHaveLength(2);
    const move = { type: "move-members", userIds: selected, department: "visual-media", groups: ["Video"] };

    for (const [cookie, payload] of [
      [soundCookie, move],
      [cell0Cookie, { ...move, userIds: [...selected, "missing-member"] }],
      [cell0Cookie, { ...move, userIds: [...selected, actor.id] }],
      [cell0Cookie, { ...move, department: "missing-department" }],
      [cell0Cookie, { ...move, groups: ["Missing group"] }],
      [cell0Cookie, { ...move, groups: [] }],
      [cell0Cookie, { ...move, userIds: [selected[0], selected[0]] }],
      [cell0Cookie, { ...move, userIds: [] }],
      [cell0Cookie, { ...move, userIds: Array.from({ length: 101 }, (_, index) => `member-${index}`) }],
    ] as const) {
      const before = await repository.read();
      const response = await action(cookie, payload);
      expect(response.status).toBe(400);
      expect(await repository.read()).toEqual(before);
      expect(await new JsonRepository(statePath).read()).toEqual(before);
    }
    const moved = await action(cell0Cookie, move);
    expect(moved.status).toBe(200);
    const saved = await new JsonRepository(statePath).read();
    for (const id of selected)
      expect(saved.users.find((member) => member.id === id)).toMatchObject({
        department: "visual-media", groups: ["Video"],
      });
    expect(saved.users.find((member) => member.id === actor.id)).toEqual(actor);
  });

  it("deletes members atomically and invalidates an already signed-in deleted member", async () => {
    const { app, repository, statePath, login, action } = await makeBulkActionHarness();
    const cell0Cookie = await login("cell-0");
    const soundCookie = await login("sound");
    const initial = await repository.read();
    const actor = initial.users.find((member) => member.department === "cell-0")!;
    const selected = initial.users.filter((member) => member.department === "sound" || !member.approved).map(({ id }) => id);
    const deletion = { type: "delete-members", userIds: selected };
    for (const [cookie, payload] of [
      [soundCookie, deletion],
      [cell0Cookie, { ...deletion, userIds: [...selected, actor.id] }],
      [cell0Cookie, { ...deletion, userIds: [...selected, "missing-member"] }],
      [cell0Cookie, { ...deletion, userIds: [selected[0], selected[0]] }],
      [cell0Cookie, { ...deletion, userIds: [] }],
      [cell0Cookie, { ...deletion, userIds: Array.from({ length: 101 }, (_, index) => `member-${index}`) }],
    ] as const) {
      expect((await action(cookie, payload)).status).toBe(400);
      expect(await new JsonRepository(statePath).read()).toEqual(initial);
    }
    expect((await app.request("/api/workspace", { headers: { cookie: soundCookie } })).status).toBe(200);
    const deleted = await action(cell0Cookie, deletion);
    expect(deleted.status).toBe(200);
    const reloaded = await new JsonRepository(statePath).read();
    expect(reloaded.users.some((member) => selected.includes(member.id))).toBe(false);
    expect(reloaded.users.find((member) => member.id === actor.id)).toEqual(actor);
    const session = await app.request("/api/session", { headers: { cookie: soundCookie } });
    expect(session.status).toBe(200);
    expect(await session.json()).toMatchObject({ user: null });
    expect((await app.request("/api/workspace", { headers: { cookie: soundCookie } })).status).toBe(401);
    const attemptedWrite = await action(soundCookie, { type: "read-notifications" });
    expect(attemptedWrite.status).toBe(401);
    expect(await repository.read()).toEqual(reloaded);
  });

  it("deletes department selections atomically while protecting Cell 0 and departments in use", async () => {
    const { repository, statePath, login, action } = await makeBulkActionHarness();
    const cell0Cookie = await login("cell-0");
    const soundCookie = await login("sound");
    const selected = ["unused-first", "unused-second"];
    await repository.update((state) => ({
      ...state,
      catalog: { ...state.catalog, departments: [...state.catalog.departments,
        ...selected.map((id) => ({ id, name: id, groups: ["General"], color: "blue" as const })),
      ] },
    }));
    const initial = await repository.read();
    const deletion = { type: "delete-departments", departmentIds: selected };
    for (const [cookie, payload] of [
      [soundCookie, deletion],
      [cell0Cookie, { ...deletion, departmentIds: [selected[0], "cell-0"] }],
      [cell0Cookie, { ...deletion, departmentIds: [selected[0], "design"] }],
      [cell0Cookie, { ...deletion, departmentIds: [selected[0], "missing-department"] }],
      [cell0Cookie, { ...deletion, departmentIds: [selected[0], selected[0]] }],
      [cell0Cookie, { ...deletion, departmentIds: [] }],
      [cell0Cookie, { ...deletion, departmentIds: Array.from({ length: 101 }, (_, index) => `department-${index}`) }],
    ] as const) {
      expect((await action(cookie, payload)).status).toBe(400);
      expect(await new JsonRepository(statePath).read()).toEqual(initial);
    }
    const deleted = await action(cell0Cookie, deletion);
    expect(deleted.status).toBe(200);
    const reloaded = await new JsonRepository(statePath).read();
    expect(reloaded.catalog.departments.map(({ id }) => id)).toEqual(
      initial.catalog.departments.filter(({ id }) => !selected.includes(id)).map(({ id }) => id),
    );
    expect(reloaded.users).toEqual(initial.users);
    expect(reloaded.tasks).toEqual(initial.tasks);
    expect(reloaded.requests).toEqual(initial.requests);
  });

  it("keeps intake private to Cell 0 and persists lifecycle milestones through rejection recovery and delivery", async () => {
    const directory = await mkdtemp(join(tmpdir(), "moc-lifecycle-api-"));
    temporaryDirectories.push(directory);
    const statePath = join(directory, "state.json");
    const repository = new JsonRepository(statePath);
    const app = createApiApp(repository);
    const login = async (department: string) => {
      const response = await app.request("/api/auth/demo", {
        method: "POST",
        headers: { origin: "http://localhost:5173", "content-type": "application/json" },
        body: JSON.stringify({ department }),
      });
      expect(response.status).toBe(200);
      return response.headers.get("set-cookie")!.split(";")[0]!;
    };
    const action = (cookie: string, payload: unknown) => app.request("/api/actions", {
      method: "POST",
      headers: { origin: "http://localhost:5173", "content-type": "application/json", cookie },
      body: JSON.stringify(payload),
    });
    const input = {
      ministry: "Youth Ministry", service: "social-content", title: "Lifecycle request",
      instructions: "Prepare the asset.", notes: "Use approved footage.",
      dueAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    };
    const createdResponse = await app.request("/api/requests", {
      method: "POST",
      headers: { origin: "http://localhost:5174", "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json() as {
      request: { id: string; createdAt: string; status: string; lifecycle: Record<string, string> };
      trackingCode: string;
    };
    expect(created.request.status).toBe("backlog");
    expect(created.request.lifecycle).toEqual({ receivedAt: created.request.createdAt });
    const cell0Cookie = await login("cell-0");
    const visualCookie = await login("visual-media");
    const workspaceFor = async (cookie: string) => {
      const response = await app.request("/api/workspace", { headers: { cookie } });
      expect(response.status).toBe(200);
      return response.json() as Promise<{ requests: unknown[] }>;
    };
    expect((await workspaceFor(visualCookie)).requests).toEqual([]);
    expect((await action(visualCookie, { type: "approve", requestId: created.request.id })).status).toBe(400);
    expect((await action(visualCookie, {
      type: "add-request-note", requestId: created.request.id, text: "Unauthorized discussion",
    })).status).toBe(400);
    expect((await action(cell0Cookie, {
      type: "reject", requestId: created.request.id, reason: "Clarify the brief.",
    })).status).toBe(200);
    const rejected = (await repository.read()).requests.find((request) => request.id === created.request.id)!;
    expect(rejected.lifecycle?.rejectedAt).toEqual(expect.any(String));
    expect(rejected.lifecycle?.approvedAt).toBeUndefined();
    expect(rejected.taskId).toBeUndefined();
    const publicEdit = await app.request("/api/requests", {
      method: "PATCH",
      headers: { origin: "http://localhost:5174", "content-type": "application/json" },
      body: JSON.stringify({ code: created.trackingCode, input }),
    });
    expect(publicEdit.status).toBe(404);

    expect((await action(cell0Cookie, { type: "approve", requestId: created.request.id })).status).toBe(200);
    const approved = (await repository.read()).requests.find((request) => request.id === created.request.id)!;
    expect(approved.status).toBe("approved");
    expect(approved.lifecycle).toMatchObject({
      receivedAt: created.request.createdAt,
      rejectedAt: rejected.lifecycle!.rejectedAt,
      approvedAt: expect.any(String),
    });
    expect((await action(cell0Cookie, { type: "approve", requestId: created.request.id })).status).toBe(400);
    expect((await workspaceFor(visualCookie)).requests).toEqual([]);
    for (const status of ["in-progress", "completed", "pending"] as const) {
      const response = await action(visualCookie, { type: "update-task", taskId: approved.taskId, status });
      expect(response.status).toBe(200);
      expect((await response.json() as { requests: unknown[] }).requests).toEqual([]);
    }
    const reloaded = await new JsonRepository(statePath).read();
    const request = reloaded.requests.find((item) => item.id === approved.id)!;
    const task = reloaded.tasks.find((item) => item.id === approved.taskId)!;
    expect(task.status).toBe("pending");
    expect(task.lifecycle).toMatchObject({
      receivedAt: created.request.createdAt, approvedAt: approved.lifecycle!.approvedAt,
      inProgressAt: expect.any(String), completedAt: expect.any(String),
    });
    expect(request.lifecycle).toEqual(task.lifecycle);
    expect(task).not.toHaveProperty("completedAt");
    const trackedResponse = await app.request("/api/track", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: created.trackingCode }),
    });
    expect(trackedResponse.status).toBe(200);
    const tracked = await trackedResponse.json() as { task: Record<string, unknown> };
    expect(tracked.task.lifecycle).toEqual(task.lifecycle);
    expect(tracked.task).not.toHaveProperty("completedAt");
    expect(tracked.task).not.toHaveProperty("privateNotes");
  });

  it("persists managed request options and routes backlog requests through the current service mapping", async () => {
    const app = await makeApp();
    const login = async (department: string) => {
      const response = await app.request("/api/auth/demo", {
        method: "POST",
        headers: {
          origin: "http://localhost:5173",
          "content-type": "application/json",
        },
        body: JSON.stringify({ department }),
      });
      expect(response.status).toBe(200);
      return response.headers.get("set-cookie")!.split(";")[0];
    };
    const action = (cookie: string, payload: unknown) =>
      app.request("/api/actions", {
        method: "POST",
        headers: {
          origin: "http://localhost:5173",
          "content-type": "application/json",
          cookie,
        },
        body: JSON.stringify(payload),
      });

    const soundCookie = await login("sound");
    expect(
      (await action(soundCookie, {
        type: "save-ministry",
        name: "Managed Ministry",
      })).status,
    ).toBe(200);
    expect(
      (await action(soundCookie, {
        type: "save-service",
        service: {
          id: "managed-service",
          name: "Managed Service",
          department: "sound",
          subTeam: "Sound",
        },
      })).status,
    ).toBe(200);

    const catalogResponse = await app.request("/api/catalog");
    const catalog = (await catalogResponse.json()) as {
      ministries: string[];
      services: Array<{ id: string }>;
      departments: Array<{ id: string }>;
    };
    expect(catalog.ministries).toContain("Managed Ministry");
    expect(catalog.services.some((service) => service.id === "managed-service")).toBe(true);
    expect(catalog.departments.map(({ id }) => id)).toContain("cell-0");

    const created = await app.request("/api/requests", {
      method: "POST",
      headers: {
        origin: "http://localhost:5174",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        ministry: "Managed Ministry",
        service: "managed-service",
        title: "Managed routing",
        instructions: "Prepare the requested asset.",
        notes: "Use the current service route.",
        dueAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      }),
    });
    expect(created.status).toBe(201);
    const request = (await created.json()) as { request: { id: string } };

    const cell0Cookie = await login("cell-0");
    expect(
      (await action(cell0Cookie, {
        type: "save-service",
        service: {
          id: "managed-service",
          name: "Managed Service",
          department: "visual-media",
          subTeam: "Video",
        },
      })).status,
    ).toBe(200);
    const approved = await action(cell0Cookie, {
      type: "approve",
      requestId: request.request.id,
    });
    expect(approved.status).toBe(200);
    const workspace = (await approved.json()) as {
      tasks: Array<{ requestId?: string; department: string; subTeam: string }>;
    };
    expect(workspace.tasks.find((task) => task.requestId === request.request.id)).toMatchObject({
      department: "visual-media",
      subTeam: "Video",
    });

    expect(
      (await action(cell0Cookie, {
        type: "delete-service",
        serviceId: "managed-service",
      })).status,
    ).toBe(400);
  });

  it("persists member group creation and assignment in one authorized action", async () => {
    const app = await makeApp();
    const seededMember = createSeedState().users.find(
      (member) => member.department === "design",
    )!;
    const login = async (department: string) => {
      const response = await app.request("/api/auth/demo", {
        method: "POST",
        headers: {
          origin: "http://localhost:5173",
          "content-type": "application/json",
        },
        body: JSON.stringify({ department }),
      });
      expect(response.status).toBe(200);
      return response.headers.get("set-cookie")!.split(";")[0];
    };
    const cell0Cookie = await login("cell-0");
    const soundCookie = await login("sound");
    const action = (cookie: string, payload: unknown) =>
      app.request("/api/actions", {
        method: "POST",
        headers: {
          origin: "http://localhost:5173",
          "content-type": "application/json",
          cookie,
        },
        body: JSON.stringify(payload),
      });

    const created = await action(cell0Cookie, {
      type: "update-member",
      userId: seededMember.id,
      changes: {
        duty: "Motion designer",
        groups: [...seededMember.groups, "Motion Lab"],
      },
      createGroups: [" Motion Lab "],
    });
    expect(created.status).toBe(200);
    const saved = (await created.json()) as {
      catalog: { departments: Array<{ id: string; groups: string[] }> };
      users: Array<{ id: string; duty: string; groups: string[] }>;
    };
    expect(saved.catalog.departments.find((item) => item.id === "design")?.groups)
      .toContain("Motion Lab");
    expect(saved.users.find((item) => item.id === seededMember.id)).toMatchObject({
      duty: "Motion designer",
      groups: [...seededMember.groups, "Motion Lab"],
    });

    const invalid = await action(cell0Cookie, {
      type: "update-member",
      userId: seededMember.id,
      changes: { groups: seededMember.groups },
      createGroups: ["Unassigned Group"],
    });
    expect(invalid.status).toBe(400);
    const forbidden = await action(soundCookie, {
      type: "update-member",
      userId: seededMember.id,
      changes: { groups: [...seededMember.groups, "Unapproved Group"] },
      createGroups: ["Unapproved Group"],
    });
    expect(forbidden.status).toBe(400);

    const catalogResponse = await app.request("/api/catalog");
    const catalog = (await catalogResponse.json()) as {
      departments: Array<{ id: string; groups: string[] }>;
    };
    const designGroups = catalog.departments.find((item) => item.id === "design")!.groups;
    expect(designGroups).toContain("Motion Lab");
    expect(designGroups).not.toContain("Unassigned Group");
    expect(designGroups).not.toContain("Unapproved Group");
  });

  it("returns saved request comments to Cell 0 while excluding them from public tracking", async () => {
    const app = await makeApp();
    const created = await app.request("/api/requests", {
      method: "POST",
      headers: {
        origin: "http://localhost:5174",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        ministry: "Youth Ministry",
        service: "social-content",
        title: "Comment visibility",
        instructions: "Prepare a reel.",
        notes: "Use approved footage.",
        dueAt: new Date(Date.now() + 86400000 * 7).toISOString(),
      }),
    });
    const receipt = (await created.json()) as {
      request: { id: string };
      trackingCode: string;
    };
    const login = await app.request("/api/auth/demo", {
      method: "POST",
      headers: {
        origin: "http://localhost:5173",
        "content-type": "application/json",
      },
      body: JSON.stringify({ department: "cell-0" }),
    });
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const saved = await app.request("/api/actions", {
      method: "POST",
      headers: {
        origin: "http://localhost:5173",
        "content-type": "application/json",
        cookie,
      },
      body: JSON.stringify({
        type: "add-request-note",
        requestId: receipt.request.id,
        text: "Private production discussion.",
      }),
    });
    expect(saved.status).toBe(200);
    const workspace = (await saved.json()) as {
      requests: Array<{ id: string; privateNotes?: Array<{ text: string }> }>;
    };
    expect(
      workspace.requests.find((item) => item.id === receipt.request.id)
        ?.privateNotes?.[0].text,
    ).toBe("Private production discussion.");
    const tracking = await app.request("/api/track", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: receipt.trackingCode }),
    });
    expect(tracking.status).toBe(200);
    expect(
      ((await tracking.json()) as { request: object }).request,
    ).not.toHaveProperty("privateNotes");
  });

  it("limits attempts by transport IP, ignoring spoofed forwarding headers", async () => {
    const app = await makeApp({
      resolveRemoteAddress: () => "198.51.100.42",
    });
    const responses: Response[] = [];
    for (let index = 0; index < 21; index += 1) {
      responses.push(
        await app.request("/api/track", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "cf-connecting-ip": `203.0.113.${index}`,
            "x-forwarded-for": `192.0.2.${index}`,
          },
          body: JSON.stringify({ code: "MOC-111111-111111-111111-111111" }),
        }),
      );
    }
    expect(
      responses.slice(0, 20).every((response) => response.status === 404),
    ).toBe(true);
    expect(responses[20]?.status).toBe(429);
  });

  it("evicts the least-recently-used IP bucket when the limiter reaches its cap", async () => {
    const app = await makeApp({
      resolveRemoteAddress: (context) => context.req.header("x-test-remote"),
      maxCredentialBuckets: 2,
    });
    const attempt = (ip: string) =>
      app.request("/api/track", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-test-remote": ip,
        },
        body: JSON.stringify({ code: "MOC-111111-111111-111111-111111" }),
      });

    for (let index = 0; index < 20; index += 1) await attempt("198.51.100.1");
    expect((await attempt("198.51.100.1")).status).toBe(429);
    for (let index = 0; index < 20; index += 1) await attempt("198.51.100.2");
    expect((await attempt("198.51.100.2")).status).toBe(429);

    expect((await attempt("198.51.100.3")).status).toBe(404);
    expect((await attempt("198.51.100.1")).status).toBe(404);
  });

  it("keeps workspace private until an approved leader signs in", async () => {
    const app = await makeApp();
    const response = await app.request("/api/workspace");
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "Sign in with an approved member account to continue.",
    });
  });

  it("lets Cell 0 members view requests while limiting their task access and decisions", async () => {
    const directory = await mkdtemp(join(tmpdir(), "moc-api-"));
    temporaryDirectories.push(directory);
    const repository = new JsonRepository(join(directory, "state.json"));
    const initial = await repository.read();
    const pendingRequest = initial.requests.find((request) => request.status === "backlog")!;
    const soundTask = initial.tasks.find((task) => task.department === "sound")!;
    const cell0Leader = initial.users.find((user) => user.department === "cell-0")!;
    const app = createApiApp(repository);
    const login = await app.request("/api/auth/demo", {
      method: "POST",
      headers: {
        origin: "http://localhost:5173",
        "content-type": "application/json",
      },
      body: JSON.stringify({ department: "cell-0" }),
    });
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    await repository.update((state) => ({
      ...state,
      users: state.users.map((user) =>
        user.id === cell0Leader.id ? { ...user, isLeader: false } : user,
      ),
      requests: state.requests.map((request) => request.id === pendingRequest.id
        ? { ...request, privateNotes: [{
            id: "cell0-private-note", text: "Intake review context.",
            author: cell0Leader.name, createdAt: new Date().toISOString(),
          }] }
        : request),
    }));

    const workspaceResponse = await app.request("/api/workspace", {
      headers: { cookie },
    });
    expect(workspaceResponse.status).toBe(200);
    const workspace = (await workspaceResponse.json()) as {
      users: Array<{ id: string }>;
      requests: Array<{ id: string; privateNotes?: unknown }>;
      tasks: Array<{ id: string; department: string }>;
    };
    expect(workspace.users).toEqual([{ ...cell0Leader, isLeader: false }]);
    const approvedTaskIds = new Set(initial.requests
      .filter((request) => request.status === "approved")
      .map((request) => request.taskId));
    expect(workspace.tasks.map((task) => task.id)).toEqual(initial.tasks
      .filter((task) => task.department === "cell-0" || approvedTaskIds.has(task.id))
      .map((task) => task.id));
    expect(workspace.requests.map((request) => request.id)).toEqual(initial.requests.map((request) => request.id));
    expect(workspace.requests).not.toContainEqual(expect.objectContaining({ trackingCodeHash: expect.anything() }));
    expect(workspace.requests.find((request) => request.id === pendingRequest.id)?.privateNotes)
      .toEqual([expect.objectContaining({ text: "Intake review context." })]);

    const approve = await app.request("/api/actions", {
      method: "POST",
      headers: {
        origin: "http://localhost:5173",
        "content-type": "application/json",
        cookie,
      },
      body: JSON.stringify({ type: "approve", requestId: pendingRequest.id }),
    });
    expect(approve.status).toBe(400);
    expect(await approve.json()).toMatchObject({ error: expect.stringMatching(/Cell 0 leader/i) });
    const comment = await app.request("/api/actions", {
      method: "POST",
      headers: { origin: "http://localhost:5173", "content-type": "application/json", cookie },
      body: JSON.stringify({ type: "add-request-note", requestId: pendingRequest.id, text: "Unauthorised comment." }),
    });
    expect(comment.status).toBe(400);

    const edit = await app.request("/api/actions", {
      method: "POST",
      headers: {
        origin: "http://localhost:5173",
        "content-type": "application/json",
        cookie,
      },
      body: JSON.stringify({ type: "update-task", taskId: soundTask.id, status: "in-progress" }),
    });
    expect(edit.status).toBe(400);
    expect(await edit.json()).toMatchObject({ error: expect.stringMatching(/only edit tasks in your department/i) });
  });

  it("keeps approved assignment snapshots visible to Cell 0 members after service remapping", async () => {
    const { app, repository, login, action } = await makeBulkActionHarness();
    const cookie = await login("cell-0");
    const initial = await repository.read();
    const request = initial.requests.find((item) => item.status === "backlog")!;
    const service = initial.catalog.services.find((item) => item.id === request.service)!;
    const cell0Member = initial.users.find((member) => member.department === "cell-0")!;
    expect((await action(cookie, { type: "approve", requestId: request.id })).status).toBe(200);
    const approved = (await repository.read()).requests.find((item) => item.id === request.id)!;
    expect((await action(cookie, {
      type: "add-note", taskId: approved.taskId, text: "Approved delivery context.",
    })).status).toBe(200);
    expect((await action(cookie, {
      type: "save-service",
      service: { ...service, department: "design", subTeam: "Art Production" },
    })).status).toBe(200);
    await repository.update((state) => ({
      ...state,
      users: state.users.map((member) => member.id === cell0Member.id
        ? { ...member, isLeader: false }
        : member),
    }));

    const response = await app.request("/api/workspace", { headers: { cookie } });
    expect(response.status).toBe(200);
    const workspace = await response.json() as WorkspaceState;
    const routedTask = workspace.tasks.find((task) => task.id === approved.taskId)!;
    expect(routedTask).toMatchObject({
      department: service.department,
      subTeam: service.subTeam,
      privateNotes: [expect.objectContaining({ text: "Approved delivery context." })],
    });
    expect(workspace.catalog.services.find((item) => item.id === service.id))
      .toMatchObject({ department: "design", subTeam: "Art Production" });
    const approvedTaskIds = new Set(workspace.requests
      .filter((item) => item.status === "approved")
      .map((item) => item.taskId));
    expect(workspace.tasks.every((task) =>
      task.department === "cell-0" || approvedTaskIds.has(task.id),
    )).toBe(true);
    expect(workspace.tasks.some((task) => task.department === "cell-0")).toBe(true);
    expect(workspace.tasks.some((task) => task.id === "task-demo-01")).toBe(false);
    expect((await action(cookie, {
      type: "update-task", taskId: routedTask.id, status: "in-progress",
    })).status).toBe(400);
    expect((await action(cookie, {
      type: "add-note", taskId: routedTask.id, text: "Not permitted.",
    })).status).toBe(400);
    const anotherBacklogRequest = workspace.requests.find((item) => item.status === "backlog")!;
    expect((await action(cookie, { type: "approve", requestId: anotherBacklogRequest.id })).status).toBe(400);
    expect((await action(cookie, {
      type: "reject", requestId: anotherBacklogRequest.id, reason: "Not permitted.",
    })).status).toBe(400);

    // Legacy request links may have only the task's requestId; conflicting links stay hidden.
    await repository.update((state) => ({
      ...state,
      requests: state.requests.map((item) => item.id === approved.id
        ? { ...item, taskId: undefined }
        : item),
    }));
    const fallbackResponse = await app.request("/api/workspace", { headers: { cookie } });
    expect(fallbackResponse.status).toBe(200);
    expect((await fallbackResponse.json() as WorkspaceState).tasks)
      .toContainEqual(expect.objectContaining({ id: routedTask.id }));
    await repository.update((state) => ({
      ...state,
      requests: state.requests.map((item) => item.id === approved.id
        ? { ...item, taskId: "missing-task" }
        : item),
    }));
    const conflictingResponse = await app.request("/api/workspace", { headers: { cookie } });
    expect(conflictingResponse.status).toBe(200);
    expect((await conflictingResponse.json() as WorkspaceState).tasks)
      .not.toContainEqual(expect.objectContaining({ id: routedTask.id }));
  });

  it("creates and tracks requests publicly, while tracking omits private task notes", async () => {
    const app = await makeApp();
    const create = await app.request("/api/requests", {
      method: "POST",
      headers: {
        origin: "http://localhost:5174",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        ministry: "Youth Ministry",
        service: "social-content",
        title: "Youth recap",
        instructions: "Prepare the recap video.",
        notes: "Use approved footage.",
        dueAt: new Date(Date.now() + 5 * 86_400_000).toISOString(),
      }),
    });
    expect(create.status).toBe(201);
    const receipt = (await create.json()) as {
      request: { reference: string; trackingCodeHash?: string };
      trackingCode: string;
    };
    expect(receipt.trackingCode).toMatch(
      /^MOC-[0-9A-HJKMNP-TV-Z]{6}(?:-[0-9A-HJKMNP-TV-Z]{6}){3}$/,
    );
    expect(receipt.request).not.toHaveProperty("trackingCodeHash");
    const tracking = await app.request("/api/track", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code: receipt.trackingCode,
      }),
    });
    expect(tracking.status).toBe(200);
    expect(await tracking.json()).toMatchObject({
      request: { reference: receipt.request.reference },
      task: null,
    });
    const seededTracking = await app.request("/api/track", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code: "MOC-444444-444444-444444-444444",
      }),
    });
    const publicProjection = (await seededTracking.json()) as {
      task: Record<string, unknown>;
    };
    expect(seededTracking.status).toBe(200);
    expect(publicProjection.task).not.toHaveProperty("privateNotes");
    expect(publicProjection.task).not.toHaveProperty("progress");

    const demo = await app.request("/api/auth/demo", {
      method: "POST",
      headers: {
        origin: "http://localhost:5173",
        "content-type": "application/json",
      },
      body: JSON.stringify({ department: "sound" }),
    });
    const cookie = demo.headers.get("set-cookie")?.split(";")[0];
    expect(demo.status).toBe(200);
    expect(cookie).toBeTruthy();
    const workspace = await app.request("/api/workspace", {
      headers: { cookie: cookie ?? "" },
    });
    const state = (await workspace.json()) as {
      tasks: Array<{ department: string; privateNotes: unknown[] }>;
      users: Array<{ department: string }>;
      requests: unknown[];
    };
    expect(state.tasks.every((task) => !Object.hasOwn(task, "progress"))).toBe(true);
    expect(state.tasks.every((task) => task.department !== "cell-0")).toBe(
      true,
    );
    expect(
      state.tasks
        .filter((task) => task.department !== "sound")
        .every((task) => task.privateNotes.length === 0),
    ).toBe(true);
    expect(
      state.tasks.some(
        (task) => task.department === "sound" && task.privateNotes.length > 0,
      ),
    ).toBe(true);
    expect(state.requests).toEqual([]);
    expect(state.users).toHaveLength(1);
    expect(state.users[0]?.department).toBe("sound");
    const invalidAction = await app.request("/api/actions", {
      method: "POST",
      headers: {
        origin: "http://localhost:5173",
        "content-type": "application/json",
        cookie: cookie ?? "",
      },
      body: JSON.stringify({
        type: "update-task",
        taskId: "task-demo-04",
        status: "unknown",
      }),
    });
    expect(invalidAction.status).toBe(400);
    const addOwnNote = await app.request("/api/actions", {
      method: "POST",
      headers: {
        origin: "http://localhost:5173",
        "content-type": "application/json",
        cookie: cookie ?? "",
      },
      body: JSON.stringify({
        type: "add-note",
        taskId: "task-demo-04",
        text: "Confirm sound check with the team.",
      }),
    });
    expect(addOwnNote.status).toBe(200);
    const afterNote = (await addOwnNote.json()) as {
      tasks: Array<{
        id: string;
        department: string;
        privateNotes: Array<{ text: string }>;
      }>;
    };
    expect(
      afterNote.tasks
        .find((task) => task.id === "task-demo-04")
        ?.privateNotes.some(
          (note) => note.text === "Confirm sound check with the team.",
        ),
    ).toBe(true);
    expect(
      afterNote.tasks
        .filter((task) => task.department !== "sound")
        .every((task) => task.privateNotes.length === 0),
    ).toBe(true);
    const restrictedIntegrations = await app.request("/api/integrations", {
      headers: { cookie: cookie ?? "" },
    });
    expect(restrictedIntegrations.status).toBe(403);

    const cell0SignIn = await app.request("/api/auth/demo", {
      method: "POST",
      headers: {
        origin: "http://localhost:5173",
        "content-type": "application/json",
      },
      body: JSON.stringify({ department: "cell-0" }),
    });
    const cell0Cookie = cell0SignIn.headers.get("set-cookie")?.split(";")[0];
    const integrations = await app.request("/api/integrations", {
      headers: { cookie: cell0Cookie ?? "" },
    });
    expect(integrations.status).toBe(200);
    expect(await integrations.json()).toEqual({
      telegramConfigured: false,
      googleConfigured: false,
      storage: "local-demo",
    });
  });

  it("uses a long bearer code alone for tracking and limits public edits to backlog requests", async () => {
    const app = await makeApp();
    const headers = {
      origin: "http://localhost:5174",
      "content-type": "application/json",
    };
    const input = {
      ministry: "Youth Ministry",
      service: "social-content",
      title: "Code-only request",
      instructions: "Prepare the recap.",
      notes: "Use approved footage.",
      dueAt: new Date(Date.now() + 5 * 86_400_000).toISOString(),
    };
    const submissions = await Promise.all(
      [1, 2].map(() =>
        app.request("/api/requests", {
          method: "POST",
          headers,
          body: JSON.stringify(input),
        }),
      ),
    );
    const receipts = await Promise.all(
      submissions.map((response) => response.json()) as Promise<{
        request: { reference: string };
        trackingCode: string;
      }>[],
    );
    expect(receipts[0]?.trackingCode).not.toBe(receipts[1]?.trackingCode);
    expect(receipts[0]?.trackingCode).toMatch(
      /^MOC-[0-9A-HJKMNP-TV-Z]{6}(?:-[0-9A-HJKMNP-TV-Z]{6}){3}$/,
    );

    const normalizedCode = receipts[0]!.trackingCode
      .replaceAll("-", "")
      .toLowerCase();
    const tracking = await app.request("/api/track", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: normalizedCode }),
    });
    expect(tracking.status).toBe(200);
    const trackingResult = await tracking.json();
    expect(trackingResult).toMatchObject({
      request: { reference: receipts[0]!.request.reference },
      task: null,
    });
    expect(JSON.stringify(trackingResult)).not.toContain(
      receipts[0]!.trackingCode,
    );
    expect(JSON.stringify(trackingResult)).not.toContain("trackingCodeHash");

    const wrongCode = await app.request("/api/track", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "MOC-111111-111111-111111-111111" }),
    });
    const missingCode = await app.request("/api/track", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(wrongCode.status).toBe(404);
    const missingPayload = await missingCode.json();
    expect(await wrongCode.json()).toEqual(missingPayload);

    const legacyLookup = await app.request("/api/track", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        reference: receipts[0]!.request.reference,
        ministry: input.ministry,
      }),
    });
    expect(legacyLookup.status).toBe(404);
    const referenceOnlyEdit = await app.request(
      `/api/requests/${receipts[0]!.request.reference}`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({ ministry: input.ministry, input }),
      },
    );
    expect(referenceOnlyEdit.status).toBe(404);

    const edited = await app.request("/api/requests", {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        code: receipts[0]!.trackingCode,
        input: { ...input, title: "Edited by code" },
      }),
    });
    expect(edited.status).toBe(200);
    expect(await edited.json()).toMatchObject({ title: "Edited by code" });

    const approvedEdit = await app.request("/api/requests", {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        code: "MOC-444444-444444-444444-444444",
        input,
      }),
    });
    expect(approvedEdit.status).toBe(404);
    expect(await approvedEdit.json()).toEqual(missingPayload);

    const rejectedEdit = await app.request("/api/requests", {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        code: "MOC-555555-555555-555555-555555",
        input,
      }),
    });
    expect(rejectedEdit.status).toBe(404);
    expect(await rejectedEdit.json()).toEqual(missingPayload);

    const cell0 = await app.request("/api/auth/demo", {
      method: "POST",
      headers,
      body: JSON.stringify({ department: "cell-0" }),
    });
    const cookie = cell0.headers.get("set-cookie")?.split(";")[0];
    const workspace = await app.request("/api/workspace", {
      headers: { cookie: cookie ?? "" },
    });
    const workspaceBody = await workspace.text();
    expect(workspace.status).toBe(200);
    expect(workspaceBody).not.toContain(receipts[0]!.trackingCode);
    expect(workspaceBody).not.toContain("trackingCodeHash");
  });

  it("persists task status changes without percentage progress and rejects legacy progress updates", async () => {
    const directory = await mkdtemp(join(tmpdir(), "moc-api-"));
    temporaryDirectories.push(directory);
    const statePath = join(directory, "state.json");
    const repository = new JsonRepository(statePath);
    const app = createApiApp(repository);
    const soundTask = (await repository.read()).tasks.find(
      (task) => task.department === "sound",
    )!;
    const login = await app.request("/api/auth/demo", {
      method: "POST",
      headers: {
        origin: "http://localhost:5173",
        "content-type": "application/json",
      },
      body: JSON.stringify({ department: "sound" }),
    });
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const headers = {
      origin: "http://localhost:5173",
      "content-type": "application/json",
      cookie,
    };

    for (const status of ["in-progress", "completed", "pending"] as const) {
      const response = await app.request("/api/actions", {
        method: "POST",
        headers,
        body: JSON.stringify({ type: "update-task", taskId: soundTask.id, status }),
      });
      expect(response.status).toBe(200);
      const workspace = (await response.json()) as {
        tasks: Array<{ id: string; status: string }>;
      };
      expect(workspace.tasks.find((task) => task.id === soundTask.id)?.status).toBe(status);
      expect(workspace.tasks.every((task) => !Object.hasOwn(task, "progress"))).toBe(true);

      const stored = await new JsonRepository(statePath).read();
      expect(stored.tasks.find((task) => task.id === soundTask.id)?.status).toBe(status);
      expect(stored.tasks.every((task) => !Object.hasOwn(task, "progress"))).toBe(true);
    }

    const beforeRejectedUpdates = await repository.read();
    for (const legacyFields of [{ progress: 25 }, { status: "completed", progress: 100 }]) {
      const response = await app.request("/api/actions", {
        method: "POST",
        headers,
        body: JSON.stringify({
          type: "update-task",
          taskId: soundTask.id,
          ...legacyFields,
        }),
      });
      expect(response.status).toBe(400);
      expect(await repository.read()).toEqual(beforeRejectedUpdates);
    }
  });

  it("returns a clear validation error for malformed public request input", async () => {
    const app = await makeApp();
    const response = await app.request("/api/requests", {
      method: "POST",
      headers: {
        origin: "http://localhost:5174",
        "content-type": "application/json",
      },
      body: "{}",
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "A valid request is required.",
    });
  });

  it("strips injected task and private-note fields from public request create and edit payloads", async () => {
    const app = await makeApp();
    const dueAt = new Date(Date.now() + 5 * 86_400_000).toISOString();
    const maliciousInput = {
      ministry: "Youth Ministry",
      service: "social-content",
      title: "Public request",
      instructions: "Prepare approved footage.",
      notes: "For the ministry team.",
      dueAt,
      status: "approved",
      taskId: "task-demo-cell0-01",
      trackingCodeHash: "forged-hash",
      lifecycle: {
        receivedAt: "2000-01-01T00:00:00.000Z",
        approvedAt: "2000-01-02T00:00:00.000Z",
      },
      privateNotes: [
        {
          id: "inject",
          text: "Cell 0 confidential content",
          author: "attacker",
          createdAt: dueAt,
        },
      ],
    };
    const createdResponse = await app.request("/api/requests", {
      method: "POST",
      headers: {
        origin: "http://localhost:5174",
        "content-type": "application/json",
      },
      body: JSON.stringify(maliciousInput),
    });
    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()) as {
      request: {
        reference: string;
        ministry: string;
        status: string;
        taskId?: string;
        privateNotes?: unknown;
        trackingCodeHash?: string;
      };
      trackingCode: string;
    };
    expect(created.request.status).toBe("backlog");
    expect(created.request).not.toHaveProperty("taskId");
    expect(created.request).not.toHaveProperty("privateNotes");
    expect(created.request).not.toHaveProperty("trackingCodeHash");
    expect(created.request).not.toHaveProperty("lifecycle.approvedAt");
    expect(created.request).not.toHaveProperty("lifecycle.receivedAt", "2000-01-01T00:00:00.000Z");

    const editedResponse = await app.request("/api/requests", {
      method: "PATCH",
      headers: {
        origin: "http://localhost:5174",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        code: created.trackingCode,
        input: maliciousInput,
      }),
    });
    expect(editedResponse.status).toBe(200);
    const edited = (await editedResponse.json()) as {
      status: string;
      taskId?: string;
      privateNotes?: unknown;
    };
    expect(edited.status).toBe("backlog");
    expect(edited).not.toHaveProperty("taskId");
    expect(edited).not.toHaveProperty("privateNotes");
    expect(edited).not.toHaveProperty("lifecycle.approvedAt");
    expect(edited).not.toHaveProperty("lifecycle.receivedAt", "2000-01-01T00:00:00.000Z");

    const tracking = await app.request("/api/track", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: created.trackingCode }),
    });
    expect(await tracking.json()).toMatchObject({ task: null });
  });

  it("approves requests without task priority and omits it from returned tasks", async () => {
    const app = await makeApp();
    const createdResponse = await app.request("/api/requests", {
      method: "POST",
      headers: {
        origin: "http://localhost:5174",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        ministry: "Youth Ministry",
        service: "social-content",
        title: "Priority-free request",
        instructions: "Create a recap reel.",
        notes: "Use approved footage.",
        dueAt: new Date(Date.now() + 7 * 86400000).toISOString(),
      }),
    });
    const created = (await createdResponse.json()) as {
      request: { id: string };
    };
    const login = await app.request("/api/auth/demo", {
      method: "POST",
      headers: {
        origin: "http://localhost:5173",
        "content-type": "application/json",
      },
      body: JSON.stringify({ department: "cell-0" }),
    });
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const approved = await app.request("/api/actions", {
      method: "POST",
      headers: {
        origin: "http://localhost:5173",
        "content-type": "application/json",
        cookie,
      },
      body: JSON.stringify({
        type: "approve",
        requestId: created.request.id,
      }),
    });
    expect(approved.status).toBe(200);
    const workspace = (await approved.json()) as {
      tasks: Array<{ requestId?: string }>;
    };
    const task = workspace.tasks.find(
      (item) => item.requestId === created.request.id,
    );
    expect(task).toBeDefined();
    expect(task).not.toHaveProperty("priority");
    expect(task).not.toHaveProperty("progress");
  });
});
