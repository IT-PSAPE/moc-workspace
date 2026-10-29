import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { Pool } from "pg";
import { createSeedState } from "@moc/shared";
import { PostgresRepository } from "../apps/api/src/postgres-repository";

// An isolated local database measures actual PostgreSQL response bytes. It never
// uses DATABASE_URL or the production Neon project. Requires local Postgres tools.
const directory = await mkdtemp("/tmp/moc-egress-");
const dataDirectory = `${directory}/data`;
let started = false;
let pool: Pool | undefined;
let receivedBytes = 0;
try {
  execFileSync("initdb", ["-D", dataDirectory, "-A", "trust", "-U", "moc_test", "--no-locale"], { stdio: "ignore" });
  execFileSync("pg_ctl", ["-D", dataDirectory, "-l", `${directory}/postgres.log`, "-o", `-k ${directory} -c listen_addresses=''`, "-w", "start"], { stdio: "ignore" });
  started = true;
  pool = new Pool({ host: directory, user: "moc_test", database: "postgres", max: 1 });
  pool.on("connect", (client) => {
    const connection = client as unknown as { connection: { stream: NodeJS.ReadableStream } };
    connection.connection.stream.on("data", (chunk: Buffer) => { receivedBytes += chunk.length; });
  });
  await pool.query(await readFile(new URL("../apps/api/migrations/001_workspace.sql", import.meta.url), "utf8"));
  await pool.query(await readFile(new URL("../apps/api/migrations/002_live_workspace.sql", import.meta.url), "utf8"));
  const state = createSeedState();
  const repository = new PostgresRepository(pool, "egress-verification");
  await repository.initialize(state);
  const measurements: Record<string, number> = {};
  async function measure<T>(label: string, operation: () => Promise<T>): Promise<T> {
    receivedBytes = 0;
    const result = await operation();
    measurements[label] = receivedBytes;
    return result;
  }
  const full = await measure("fullWorkspace", () => repository.read());
  assert.deepEqual(await measure("catalog", () => repository.readCatalog()), full.catalog);
  const member = full.users.find((user) => user.approved && user.isLeader)!;
  assert.deepEqual(await measure("memberById", () => repository.findApprovedLeaderById(member.id)), member);
  assert.deepEqual(await measure("memberByEmail", () => repository.findApprovedLeaderByGoogleEmail(` ${member.email.toUpperCase()} `)), member);
  assert(measurements.catalog! < measurements.fullWorkspace! / 2);
  assert(measurements.memberByEmail! < measurements.fullWorkspace! / 2);

  const membershipVersions = async () => (await pool!.query("SELECT member_id, xmin::text AS version FROM moc.workspace_members ORDER BY member_id")).rows;
  const before = await membershipVersions();
  await repository.update((current) => ({ ...current, notifications: [...current.notifications] }));
  assert.deepEqual(await membershipVersions(), before, "unrelated workspace changes must not rewrite all membership rows");
  await repository.update((current) => ({ ...current, users: current.users.map((user) => user.id === member.id ? { ...user, approved: false } : user) }));
  assert.equal(await repository.findApprovedLeaderById(member.id), null, "revocation must take effect immediately");
  assert.equal(await repository.findApprovedLeaderByGoogleEmail(member.email), null);
  const membership = await pool.query("SELECT approved FROM moc.workspace_members WHERE member_id = $1", [member.id]);
  assert.equal(membership.rows[0]?.approved, false, "Realtime membership projection must retain revocations");

  const legacy = { ...full, users: full.users.map(({ duty, groups: _groups, isLeader: _isLeader, ...user }) => ({ ...user, rank: duty })) };
  await pool.query("UPDATE moc.workspace_state SET payload = $2::jsonb WHERE id = $1", ["egress-verification", JSON.stringify(legacy)]);
  const normalized = (await repository.read()).users.find((user) => user.id === member.id);
  assert.deepEqual(await repository.findApprovedLeaderById(member.id), normalized, "projected reads retain legacy duty and group migration");

  const result = {
    fixture: "createSeedState; isolated local PostgreSQL; incoming wire bytes per read",
    measurements,
    catalogReductionPercent: Math.round(100 * (1 - measurements.catalog! / measurements.fullWorkspace!)),
    memberLookupReductionPercent: Math.round(100 * (1 - measurements.memberByEmail! / measurements.fullWorkspace!)),
    checks: ["projection shapes", "parameterized member lookup", "immediate revocation", "membership write suppression", "legacy normalization"],
  };
  await mkdir("output/playwright/egress", { recursive: true });
  await writeFile("output/playwright/egress/postgres-verification.json", JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result));
} finally {
  await pool?.end();
  if (started) execFileSync("pg_ctl", ["-D", dataDirectory, "-m", "fast", "-w", "stop"], { stdio: "ignore" });
  await rm(directory, { recursive: true, force: true });
}
