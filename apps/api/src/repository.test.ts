import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSeedState, DEPARTMENT_COLORS } from "@moc/shared";
import { JsonRepository } from "./repository";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("JSON repository migrations", () => {
  it("preserves optional request availability through updates and repository reloads", async () => {
    const directory = await mkdtemp(join(tmpdir(), "moc-catalog-availability-"));
    temporaryDirectories.push(directory);
    const filePath = join(directory, "state.json");
    const repository = new JsonRepository(filePath);
    const initial = await repository.read();
    expect(initial.catalog.disabledMinistries ?? []).toEqual([]);
    expect(initial.catalog.services.every((service) => service.enabled !== false)).toBe(true);
    const ministry = initial.catalog.ministries[0]!;
    const serviceId = initial.catalog.services[0]!.id;

    await repository.update((state) => ({
      ...state,
      catalog: {
        ...state.catalog,
        disabledMinistries: [ministry],
        services: state.catalog.services.map((service) => service.id === serviceId
          ? { ...service, enabled: false }
          : service),
      },
    }));
    const reloaded = await new JsonRepository(filePath).read();
    expect(reloaded.catalog.disabledMinistries).toEqual([ministry]);
    expect(reloaded.catalog.services.find(({ id }) => id === serviceId)?.enabled).toBe(false);
    expect(reloaded.requests).toEqual(initial.requests);
    expect(reloaded.tasks).toEqual(initial.tasks);

    await repository.update((state) => ({
      ...state,
      catalog: {
        ...state.catalog,
        disabledMinistries: [],
        services: state.catalog.services.map((service) => service.id === serviceId
          ? { ...service, enabled: true }
          : service),
      },
    }));
    const enabled = await new JsonRepository(filePath).read();
    expect(enabled.catalog.disabledMinistries).toEqual([]);
    expect(enabled.catalog.services.find(({ id }) => id === serviceId)?.enabled).toBe(true);
  });

  it("keeps legacy request catalogs enabled when availability fields are absent", async () => {
    const directory = await mkdtemp(join(tmpdir(), "moc-catalog-availability-"));
    temporaryDirectories.push(directory);
    const filePath = join(directory, "state.json");
    const state = createSeedState();
    const { disabledMinistries: _disabled, ...catalog } = state.catalog;
    const legacy = {
      ...state,
      catalog: {
        ...catalog,
        services: catalog.services.map(({ enabled: _enabled, ...service }) => service),
      },
    };
    const source = JSON.stringify(legacy);
    await writeFile(filePath, source);
    const reloaded = await new JsonRepository(filePath).read();
    expect(reloaded).toEqual(legacy);
    expect(reloaded.catalog.disabledMinistries).toBeUndefined();
    expect(reloaded.catalog.services.every((service) => service.enabled !== false)).toBe(true);
    expect(await readFile(filePath, "utf8")).toBe(source);
  });

  it("rejects malformed request availability without rewriting persisted state", async () => {
    const state = createSeedState();
    const ministry = state.catalog.ministries[0]!;
    const malformedCatalogs = [
      ...[null, false, "Ministry", ["Unknown Ministry"], [ministry, ministry], [42]]
        .map((disabledMinistries) => ({ ...state.catalog, disabledMinistries })),
      ...[null, "false", 0, []].map((enabled) => ({
        ...state.catalog,
        services: state.catalog.services.map((service, index) => index === 0
          ? { ...service, enabled }
          : service),
      })),
    ];
    for (const catalog of malformedCatalogs) {
      const directory = await mkdtemp(join(tmpdir(), "moc-catalog-availability-"));
      temporaryDirectories.push(directory);
      const filePath = join(directory, "state.json");
      const source = JSON.stringify({ ...state, catalog });
      await writeFile(filePath, source);
      await expect(new JsonRepository(filePath).read()).rejects.toThrow(/availability|service catalog.*malformed/i);
      expect(await readFile(filePath, "utf8")).toBe(source);
    }
  });

  it("migrates request backlog and known completion dates without fabricating other milestones", async () => {
    const directory = await mkdtemp(join(tmpdir(), "moc-lifecycle-"));
    temporaryDirectories.push(directory);
    const filePath = join(directory, "state.json");
    const state = createSeedState();
    const knownCompletedAt = "2026-10-20T14:30:00.000Z";
    const legacy = {
      ...state,
      requests: state.requests.map(({ lifecycle: _lifecycle, ...request }, index) => ({
        ...request,
        status: index === 0 ? "pending" : request.status,
      })),
      tasks: state.tasks.map(({ lifecycle: _lifecycle, ...task }, index) => ({
        ...task,
        ...(index === 0 ? { completedAt: knownCompletedAt } : {}),
      })),
    };
    await writeFile(filePath, JSON.stringify(legacy));

    const repository = new JsonRepository(filePath);
    const migrated = await repository.read();
    expect(migrated.requests[0]?.status).toBe("backlog");
    expect(migrated.requests.every((request) => request.lifecycle === undefined)).toBe(true);
    expect(migrated.tasks[0]?.lifecycle).toEqual({ completedAt: knownCompletedAt });
    expect(migrated.tasks.slice(1).every((task) => task.lifecycle === undefined)).toBe(true);
    expect(migrated.tasks.every((task) => !Object.hasOwn(task, "completedAt"))).toBe(true);
    expect(JSON.parse(await readFile(filePath, "utf8"))).toEqual(migrated);
    expect(await new JsonRepository(filePath).read()).toEqual(migrated);
  });

  it("persists partial lifecycle dates through updates and reloads", async () => {
    const directory = await mkdtemp(join(tmpdir(), "moc-lifecycle-"));
    temporaryDirectories.push(directory);
    const filePath = join(directory, "state.json");
    const repository = new JsonRepository(filePath);
    const receivedAt = "2026-10-20T08:00:00.000Z";
    const approvedAt = "2026-10-20T10:30:00.000Z";
    const inProgressAt = "2026-10-21T09:00:00+02:00";
    await repository.update((state) => ({
      ...state,
      requests: state.requests.map((request, index) => index === 0
        ? { ...request, lifecycle: { receivedAt, approvedAt } }
        : request),
      tasks: state.tasks.map((task, index) => index === 0
        ? { ...task, lifecycle: { receivedAt, approvedAt, inProgressAt } }
        : task),
    }));

    const reloaded = await new JsonRepository(filePath).read();
    expect(reloaded.requests[0]?.lifecycle).toEqual({ receivedAt, approvedAt });
    expect(reloaded.tasks[0]?.lifecycle).toEqual({ receivedAt, approvedAt, inProgressAt });
    expect(reloaded.tasks[0]?.lifecycle).not.toHaveProperty("completedAt");
  });

  it("copies known aired dates onto linked tasks while preserving an existing task snapshot", async () => {
    const directory = await mkdtemp(join(tmpdir(), "moc-task-brief-"));
    temporaryDirectories.push(directory);
    const filePath = join(directory, "state.json");
    const state = createSeedState();
    const firstTask = state.tasks[0]!;
    const secondTask = state.tasks[1]!;
    const requestDates = ["2026-09-13", "2026-09-20"];
    const taskSnapshot = ["2026-08-02"];
    const source = {
      ...state,
      requests: state.requests.map((request, index) => index < 2
        ? { ...request, taskId: index === 0 ? firstTask.id : secondTask.id, airedDates: requestDates }
        : request),
      tasks: state.tasks.map((task, index) => index === 0
        ? { ...task, requestId: state.requests[0]!.id, airedDates: undefined }
        : index === 1 ? { ...task, airedDates: taskSnapshot } : task),
    };
    await writeFile(filePath, JSON.stringify(source));
    const migrated = await new JsonRepository(filePath).read();
    expect(migrated.tasks[0]?.airedDates).toEqual(requestDates);
    expect(migrated.tasks[1]?.airedDates).toEqual(taskSnapshot);
    expect(JSON.parse(await readFile(filePath, "utf8"))).toEqual(migrated);
    expect(await new JsonRepository(filePath).read()).toEqual(migrated);
  });

  it("rejects malformed lifecycle objects on read without rewriting persisted state", async () => {
    const state = createSeedState();
    for (const lifecycle of [null, [], "2026-10-20", { receivedAt: "tomorrow" },
      { completedAt: "2026-02-30T12:00:00.000Z" }, { approvedAt: "2026-10-20" },
      { receivedAt: 42 }, { inventedAt: "2026-10-20T12:00:00.000Z" }]) {
      const directory = await mkdtemp(join(tmpdir(), "moc-lifecycle-"));
      temporaryDirectories.push(directory);
      const filePath = join(directory, "state.json");
      const source = JSON.stringify({
        ...state,
        requests: state.requests.map((request, index) => index === 0
          ? { ...request, status: "pending", lifecycle }
          : request),
      });
      await writeFile(filePath, source);
      await expect(new JsonRepository(filePath).read()).rejects.toThrow(/lifecycle.*malformed/i);
      expect(await readFile(filePath, "utf8")).toBe(source);
    }
  });

  it("rejects malformed lifecycle writes atomically and remains usable for the next update", async () => {
    const directory = await mkdtemp(join(tmpdir(), "moc-lifecycle-"));
    temporaryDirectories.push(directory);
    const filePath = join(directory, "state.json");
    const repository = new JsonRepository(filePath);
    const before = await repository.read();
    await expect(repository.update((state) => ({
      ...state,
      tasks: state.tasks.map((task, index) => index === 0
        ? { ...task, lifecycle: { completedAt: "invalid" } }
        : task),
    }))).rejects.toThrow(/lifecycle.*malformed/i);
    expect(await repository.read()).toEqual(before);
    const recovered = await repository.update((state) => ({ ...state }));
    expect(recovered).toEqual(before);
  });

  it("reloads every department color preset without losing the saved color", async () => {
    const directory = await mkdtemp(join(tmpdir(), "moc-palette-"));
    temporaryDirectories.push(directory);
    const filePath = join(directory, "state.json");
    const state = createSeedState();
    state.catalog.departments.push(...DEPARTMENT_COLORS.map((color) => ({ id: `palette-${color}`, name: `Palette ${color}`, groups: ["General"], color })));
    await writeFile(filePath, JSON.stringify(state));
    const loaded = await new JsonRepository(filePath).read();
    expect(loaded.catalog.departments.filter((item) => item.id.startsWith("palette-")).map((item) => item.color)).toEqual([...DEPARTMENT_COLORS]);
  });

  it("replaces generated percentage history with neutral status history without inferring an old state", async () => {
    const directory = await mkdtemp(join(tmpdir(), "moc-repository-"));
    temporaryDirectories.push(directory);
    const filePath = join(directory, "state.json");
    const state = createSeedState();
    const activity = state.activities[0]!;
    const notification = state.notifications[0]!;
    const legacyState = {
      ...state,
      activities: [
        { ...activity, id: "legacy-domain", type: "progress", text: "Older task updated to 75% complete." },
        { ...activity, id: "legacy-seed", type: "progress", text: "Seed task is now 50% complete." },
        { ...activity, id: "legacy-type-only", type: "progress", text: "Historical task update." },
        { ...activity, id: "unrelated", type: "note", text: "Use 50% of the available footage." },
      ],
      notifications: [
        { ...notification, id: "legacy-notification", text: "Older task updated to 0% complete." },
        { ...notification, id: "unrelated-notification", text: "Use 50% of the available footage." },
      ],
    };
    await writeFile(filePath, `${JSON.stringify(legacyState, null, 2)}\n`);

    const migrated = await new JsonRepository(filePath).read();
    const expected = {
      ...legacyState,
      activities: [
        { ...legacyState.activities[0], type: "status", text: "Older task status updated." },
        { ...legacyState.activities[1], type: "status", text: "Seed task status updated." },
        { ...legacyState.activities[2], type: "status" },
        legacyState.activities[3],
      ],
      notifications: [
        { ...legacyState.notifications[0], text: "Older task status updated." },
        legacyState.notifications[1],
      ],
    };

    expect(migrated).toEqual(expected);
    expect(JSON.parse(await readFile(filePath, "utf8"))).toEqual(expected);
    expect(await new JsonRepository(filePath).read()).toEqual(expected);
  });

  it("removes legacy task percentages from reads and storage while preserving task states", async () => {
    const directory = await mkdtemp(join(tmpdir(), "moc-repository-"));
    temporaryDirectories.push(directory);
    const filePath = join(directory, "state.json");
    const state = createSeedState();
    const legacyState = {
      ...state,
      tasks: state.tasks.map((task, index) => ({
        ...task,
        progress: index % 2 === 0 ? 100 : 0,
      })),
    };
    await writeFile(filePath, `${JSON.stringify(legacyState, null, 2)}\n`);

    const repository = new JsonRepository(filePath);
    const migrated = await repository.read();
    const stored = JSON.parse(await readFile(filePath, "utf8")) as {
      tasks: Array<Record<string, unknown>>;
    };

    expect(migrated.tasks.map((task) => task.status)).toEqual(
      state.tasks.map((task) => task.status),
    );
    expect(migrated.tasks.every((task) => !("progress" in task))).toBe(true);
    expect(stored.tasks.every((task) => !("progress" in task))).toBe(true);
    expect(migrated).toEqual(state);
    expect(stored).toEqual(state);
    expect(await new JsonRepository(filePath).read()).toEqual(state);
  });

  it("removes legacy task priority from reads and storage while preserving other data", async () => {
    const directory = await mkdtemp(join(tmpdir(), "moc-repository-"));
    temporaryDirectories.push(directory);
    const filePath = join(directory, "state.json");
    const state = createSeedState();
    const legacyState = {
      ...state,
      tasks: state.tasks.map((task) => ({ ...task, priority: "urgent" })),
    };
    await writeFile(filePath, `${JSON.stringify(legacyState, null, 2)}\n`);

    const repository = new JsonRepository(filePath);
    const migrated = await repository.read();
    const stored = JSON.parse(await readFile(filePath, "utf8")) as {
      tasks: Array<Record<string, unknown>>;
    };

    expect(migrated).toEqual(state);
    expect(migrated.tasks.every((task) => !("priority" in task))).toBe(true);
    expect(stored.tasks.every((task) => !("priority" in task))).toBe(true);
    expect(stored).toEqual(state);
  });

  it("migrates legacy rank members and seeds a persisted catalog without losing approval state", async () => {
    const directory = await mkdtemp(join(tmpdir(), "moc-repository-"));
    temporaryDirectories.push(directory);
    const filePath = join(directory, "state.json");
    const state = createSeedState();
    const legacy = {
      ...state,
      catalog: undefined,
      users: state.users.map((user, index) => {
        const { duty, groups: _groups, isLeader: _isLeader, ...rest } = user;
        return { ...rest, rank: index === 0 ? "CMN" : duty };
      }),
      tasks: state.tasks.map((task) => ({ ...task, priority: "urgent" })),
    };
    await writeFile(filePath, `${JSON.stringify(legacy, null, 2)}\n`);

    const repository = new JsonRepository(filePath);
    const migrated = await repository.read();
    const persisted = JSON.parse(await readFile(filePath, "utf8")) as {
      users: Array<Record<string, unknown>>;
      tasks: Array<Record<string, unknown>>;
      catalog: { departments: Array<{ id: string; color: string }> };
    };
    const pendingBefore = state.users.find((user) => !user.approved)!;
    const pendingAfter = migrated.users.find((user) => user.id === pendingBefore.id)!;

    expect(migrated.catalog.departments.map(({ id, color }) => [id, color])).toEqual([
      ["cell-0", "pink"],
      ["design", "purple"],
      ["sound", "amber"],
      ["visual-media", "blue"],
    ]);
    expect(migrated.users[0]).toMatchObject({ duty: "CMN", isLeader: true });
    expect(pendingAfter).toMatchObject({
      approved: false,
      isLeader: true,
      duty: pendingBefore.duty,
      groups: migrated.catalog.departments.find((item) => item.id === pendingBefore.department)!.groups,
    });
    expect(persisted.users.every((user) => !("rank" in user))).toBe(true);
    expect(persisted.users.every((user) => !("priority" in user))).toBe(true);
    expect(persisted.tasks.every((task) => !("priority" in task))).toBe(true);
    expect(await repository.read()).toEqual(migrated);
  });

  it("fails on malformed persisted state instead of reseeding it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "moc-repository-"));
    temporaryDirectories.push(directory);
    const filePath = join(directory, "state.json");
    const state = createSeedState();
    await writeFile(
      filePath,
      JSON.stringify({ ...state, catalog: { ministries: "broken" } }),
    );

    await expect(new JsonRepository(filePath).read()).rejects.toThrow(
      /catalog (is incomplete|ministry catalog is malformed)/i,
    );
    expect(JSON.parse(await readFile(filePath, "utf8"))).toMatchObject({
      catalog: { ministries: "broken" },
    });
  });

  it("rejects partial explicit catalogs without rewriting their bytes", async () => {
    const state = createSeedState();
    const partialCatalogs = [
      { ministries: [...state.catalog.ministries] },
      {
        ministries: [...state.catalog.ministries],
        services: state.catalog.services.map((service) => ({ ...service })),
        departments: state.catalog.departments.map(({ color: _color, ...department }) => department),
      },
    ];

    for (const catalog of partialCatalogs) {
      const directory = await mkdtemp(join(tmpdir(), "moc-repository-"));
      temporaryDirectories.push(directory);
      const filePath = join(directory, "state.json");
      const original = `${JSON.stringify({ ...state, catalog }, null, 2)}\n`;
      await writeFile(filePath, original);

      await expect(new JsonRepository(filePath).read()).rejects.toThrow(
        /catalog (is incomplete|is malformed)/i,
      );
      expect(await readFile(filePath, "utf8")).toBe(original);
    }
  });

  it("supplements the seed catalog with arbitrary ministry names used by legacy tasks when no catalog exists", async () => {
    const directory = await mkdtemp(join(tmpdir(), "moc-repository-"));
    temporaryDirectories.push(directory);
    const filePath = join(directory, "state.json");
    const state = createSeedState();
    const legacy = {
      ...state,
      catalog: undefined,
      tasks: state.tasks.map((task, index) =>
        index === 0 ? { ...task, ministry: "Legacy One-off Ministry" } : task,
      ),
    };
    await writeFile(filePath, `${JSON.stringify(legacy, null, 2)}\n`);

    const migrated = await new JsonRepository(filePath).read();
    expect(migrated.catalog.ministries).toContain("Legacy One-off Ministry");
    expect(migrated.tasks[0]?.ministry).toBe("Legacy One-off Ministry");
  });
});
