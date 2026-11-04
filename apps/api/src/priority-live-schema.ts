import type { Pool } from "pg";

// Same additive change as migration 003. This allows a deployment made while
// Neon is suspended to finish its schema upgrade when database access returns.
export const priorityLiveMigrationSql = `ALTER TABLE moc.workspace_members
  ADD COLUMN IF NOT EXISTS live_revision bigint NOT NULL DEFAULT 0;`;

const ready = new WeakMap<Pool, Promise<void>>();

export function ensurePriorityLiveSchema(pool: Pool): Promise<void> {
  let pending = ready.get(pool);
  if (!pending) {
    pending = applyIfMissing(pool).catch((error) => {
      ready.delete(pool);
      throw error;
    });
    ready.set(pool, pending);
  }
  return pending;
}

async function applyIfMissing(pool: Pool): Promise<void> {
  const result = await pool.query(`SELECT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'moc.workspace_members'::regclass
      AND attname = 'live_revision' AND NOT attisdropped
  ) AS ready`);
  if (result.rows[0]?.ready) return;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '10s'");
    await client.query(priorityLiveMigrationSql);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
