import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApiApp } from "./index";
import { JsonRepository } from "./repository";
import { createSeedState } from "@moc/shared";

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

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("MOC API", () => {
  it("persists managed request options and routes pending requests through the current service mapping", async () => {
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

  it("limits Cell 0 members to their own workspace data and department tasks", async () => {
    const directory = await mkdtemp(join(tmpdir(), "moc-api-"));
    temporaryDirectories.push(directory);
    const repository = new JsonRepository(join(directory, "state.json"));
    const initial = await repository.read();
    const pendingRequest = initial.requests.find((request) => request.status === "pending")!;
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
    }));

    const workspaceResponse = await app.request("/api/workspace", {
      headers: { cookie },
    });
    expect(workspaceResponse.status).toBe(200);
    const workspace = (await workspaceResponse.json()) as {
      users: Array<{ id: string }>;
      requests: Array<{ id: string; privateNotes?: unknown }>;
      tasks: Array<{ department: string }>;
    };
    expect(workspace.users).toEqual([{ ...cell0Leader, isLeader: false }]);
    expect(workspace.tasks.every((task) => task.department === "cell-0")).toBe(true);
    expect(workspace.requests.some((request) => request.id === pendingRequest.id)).toBe(false);
    expect(workspace.requests.every((request) => !request.privateNotes)).toBe(true);

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

    const edit = await app.request("/api/actions", {
      method: "POST",
      headers: {
        origin: "http://localhost:5173",
        "content-type": "application/json",
        cookie,
      },
      body: JSON.stringify({ type: "update-task", taskId: soundTask.id, progress: 25 }),
    });
    expect(edit.status).toBe(400);
    expect(await edit.json()).toMatchObject({ error: expect.stringMatching(/only edit tasks in your department/i) });
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
    };
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
        progress: 120,
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

  it("uses a long bearer code alone for tracking and limits public edits to pending requests", async () => {
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
    expect(created.request.status).toBe("pending");
    expect(created.request).not.toHaveProperty("taskId");
    expect(created.request).not.toHaveProperty("privateNotes");
    expect(created.request).not.toHaveProperty("trackingCodeHash");

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
    expect(edited.status).toBe("pending");
    expect(edited).not.toHaveProperty("taskId");
    expect(edited).not.toHaveProperty("privateNotes");

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
  });
});
