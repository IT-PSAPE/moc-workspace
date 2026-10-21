import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSeedState } from "@moc/shared";
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
