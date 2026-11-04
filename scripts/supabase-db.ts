import "../apps/api/src/load-env";
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Client, Pool } from "pg";
import { databaseConnectionOptions } from "../apps/api/src/database-config";
import { PostgresRepository } from "../apps/api/src/postgres-repository";

const direct = process.env.SUPABASE_DATABASE_URL_DIRECT || process.env.SUPABASE_DATABASE_URL;
if (!direct) throw new Error("Set SUPABASE_DATABASE_URL_DIRECT (or SUPABASE_DATABASE_URL) before running migrations.");
const client = new Client({ ...databaseConnectionOptions(direct), connectionTimeoutMillis: 10_000 });
await client.connect();
try {
  await client.query("BEGIN");
  const directory = new URL("../supabase/migrations/", import.meta.url);
  await client.query("CREATE SCHEMA IF NOT EXISTS moc");
  await client.query("CREATE TABLE IF NOT EXISTS moc.schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())");
  for (const file of (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort()) {
    const sql = await readFile(new URL(file, directory), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const existing = await client.query("SELECT checksum FROM moc.schema_migrations WHERE name = $1", [file]);
    if (existing.rows[0]) {
      if (existing.rows[0].checksum !== checksum) throw new Error(`Applied migration changed: ${file}`);
      continue;
    }
    await client.query(sql);
    await client.query("INSERT INTO moc.schema_migrations (name, checksum) VALUES ($1, $2)", [file, checksum]);
  }
  await client.query("ALTER TABLE moc.schema_migrations ENABLE ROW LEVEL SECURITY");
  await client.query("REVOKE ALL ON moc.schema_migrations FROM PUBLIC");
  await client.query("COMMIT");
  console.log("PASS Postgres migrations: workspace state, report exports, live membership and priority signals");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
const pool = new Pool({ ...databaseConnectionOptions(process.env.SUPABASE_DATABASE_URL || direct), max: 2 });
try {
  const repository = new PostgresRepository(pool);
  await repository.initialize();
  const index = process.argv.indexOf("--admin-email");
  if (index !== -1) {
    const email = process.argv[index + 1]?.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Supply a valid administrator email.");
    await repository.update((state) => {
      const existing = state.users.find((user) => user.email.toLowerCase() === email);
      if (existing) {
        if (!existing.approved || !existing.isLeader || existing.department !== "cell-0") throw new Error("This member already exists with different access; use Settings to change it.");
        return state;
      }
      if (state.users.some((user) => user.approved && user.isLeader && user.department === "cell-0")) throw new Error("An administrator already exists; invite other members from Settings.");
      return { ...state, users: [{ id: `member-${createHash("sha256").update(email).digest("hex").slice(0, 20)}`, name: email.split("@")[0], email, duty: "Administrator", department: "cell-0", groups: ["Cell 0"], isLeader: true, approved: true }] };
    });
    console.log(`PASS approved Cell 0 administrator: ${email}`);
  }
  console.log("PASS workspace initialized without demo tasks or identities");
} finally {
  await pool.end();
}
