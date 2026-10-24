import "../apps/api/src/load-env";
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Client, Pool } from "pg";
import { PostgresRepository } from "../apps/api/src/postgres-repository";

const direct = process.env.DATABASE_URL_UNPOOLED;
if (!direct) throw new Error("Pull Neon environment variables before running migrations.");
const client = new Client({ connectionString: direct, connectionTimeoutMillis: 10_000 });
await client.connect();
try {
  await client.query("BEGIN");
  const directory = new URL("../apps/api/migrations/", import.meta.url);
  for (const file of (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort()) {
    await client.query(await readFile(new URL(file, directory), "utf8"));
  }
  await client.query("COMMIT");
  console.log("PASS Postgres migrations: workspace state, report exports, live membership and revisions");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
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
