import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApiApp } from "./index";
import { JsonRepository } from "./repository";

process.env.DEMO_MODE = "true";

const temporaryDirectories: string[] = [];

async function makeApp() {
  const directory = await mkdtemp(join(tmpdir(), "moc-api-"));
  temporaryDirectories.push(directory);
  return createApiApp(new JsonRepository(join(directory, "state.json")));
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("MOC API", () => {
  it("keeps workspace private until an approved leader signs in", async () => {
    const app = await makeApp();
    const response = await app.request("/api/workspace");
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "Sign in with an approved leader account to continue.",
    });
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
    const created = (await create.json()) as {
      reference: string;
      ministry: string;
    };
    const tracking = await app.request("/api/track", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        reference: created.reference,
        ministry: created.ministry,
      }),
    });
    expect(tracking.status).toBe(200);
    expect(await tracking.json()).toMatchObject({
      request: { reference: created.reference },
      task: null,
    });
    const seededTracking = await app.request("/api/track", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        reference: `MOC-${new Date().getFullYear()}-0003`,
        ministry: "Community Outreach",
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
      reference: string;
      ministry: string;
      status: string;
      taskId?: string;
      privateNotes?: unknown;
    };
    expect(created.status).toBe("pending");
    expect(created).not.toHaveProperty("taskId");
    expect(created).not.toHaveProperty("privateNotes");

    const editedResponse = await app.request(
      `/api/requests/${created.reference}`,
      {
        method: "PATCH",
        headers: {
          origin: "http://localhost:5174",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          ministry: created.ministry,
          input: maliciousInput,
        }),
      },
    );
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
      body: JSON.stringify({
        reference: created.reference,
        ministry: created.ministry,
      }),
    });
    expect(await tracking.json()).toMatchObject({ task: null });
  });
});
