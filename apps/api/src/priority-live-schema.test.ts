import { readFile } from "node:fs/promises";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { ensurePriorityLiveSchema, priorityLiveMigrationSql } from "./priority-live-schema";

function harness(exists: boolean) {
  const query = vi.fn().mockResolvedValue({ rows: [] });
  const release = vi.fn();
  const connect = vi.fn().mockResolvedValue({ query, release });
  const probe = vi.fn().mockResolvedValue({ rows: [{ ready: exists }] });
  const pool = { query: probe, connect } as unknown as Pool;
  return { pool, query, probe, connect, release };
}

describe("deferred priority schema upgrade", () => {
  it("matches the committed migration SQL", async () => {
    const migration = await readFile(new URL("../migrations/003_priority_live_updates.sql", import.meta.url), "utf8");
    const normalize = (sql: string) => sql.replace(/--[^\n]*/g, "").replace(/\s+/g, " ").trim();
    expect(normalize(priorityLiveMigrationSql)).toBe(normalize(migration));
  });

  it("does not acquire a schema lock when the column already exists", async () => {
    const { pool, probe, connect } = harness(true);
    await ensurePriorityLiveSchema(pool);
    await ensurePriorityLiveSchema(pool);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(connect).not.toHaveBeenCalled();
  });

  it("shares one upgrade across simultaneous writes and capability requests", async () => {
    const { pool, query, probe, release } = harness(false);
    await Promise.all([ensurePriorityLiveSchema(pool), ensurePriorityLiveSchema(pool)]);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(query.mock.calls.map(([sql]) => sql)).toEqual([
      "BEGIN", "SET LOCAL lock_timeout = '5s'", "SET LOCAL statement_timeout = '10s'", priorityLiveMigrationSql, "COMMIT",
    ]);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("retries after quota recovery without caching a failed probe", async () => {
    const { pool, probe } = harness(true);
    probe.mockRejectedValueOnce(new Error("quota exceeded"));
    await expect(ensurePriorityLiveSchema(pool)).rejects.toThrow("quota exceeded");
    await ensurePriorityLiveSchema(pool);
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("rolls back and releases the connection after a failed schema change", async () => {
    const { pool, query, release, probe } = harness(false);
    query.mockImplementation(async (sql: string) => {
      if (sql === priorityLiveMigrationSql) throw new Error("lock timeout");
      return { rows: [] };
    });
    await expect(ensurePriorityLiveSchema(pool)).rejects.toThrow("lock timeout");
    expect(query).toHaveBeenLastCalledWith("ROLLBACK");
    expect(release).toHaveBeenCalledTimes(1);
    probe.mockResolvedValue({ rows: [{ ready: true }] });
    await ensurePriorityLiveSchema(pool);
    expect(probe).toHaveBeenCalledTimes(2);
  });
});
