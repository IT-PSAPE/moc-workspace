import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, mkdir, writeFile } from "node:fs/promises";
import { Pool } from "pg";
import { applyAction, createRequest, createSeedState } from "@moc/shared";
import { PostgresRepository } from "../apps/api/src/postgres-repository";
import { ensurePriorityLiveSchema } from "../apps/api/src/priority-live-schema";
import { workspaceLiveSql } from "../apps/api/src/realtime";

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
  const migrationDirectory = new URL("../apps/api/migrations/", import.meta.url);
  for (const file of (await readdir(migrationDirectory)).filter((file) => file.endsWith(".sql")).sort())
    await pool.query(await readFile(new URL(file, migrationDirectory), "utf8"));
  // Simulate the currently deployed 001/002 schema and its preserved members.
  await pool.query("ALTER TABLE moc.workspace_members DROP COLUMN live_revision");
  await pool.query("INSERT INTO moc.workspace_state (id, payload) VALUES ('bootstrap-check', '{}'::jsonb)");
  await pool.query("INSERT INTO moc.workspace_members (workspace_id, member_id, approved) VALUES ('bootstrap-check', 'existing-member', true)");
  await Promise.all([ensurePriorityLiveSchema(pool), ensurePriorityLiveSchema(pool)]);
  assert.deepEqual((await pool.query("SELECT member_id, approved, live_revision FROM moc.workspace_members WHERE workspace_id = 'bootstrap-check'")).rows,
    [{ member_id: "existing-member", approved: true, live_revision: "0" }], "deferred schema upgrade preserves existing membership and initializes its counter");
  await pool.query("DELETE FROM moc.workspace_members WHERE workspace_id = 'bootstrap-check'");
  await pool.query("DELETE FROM moc.workspace_state WHERE id = 'bootstrap-check'");
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
  const diagnosticUrl = `postgresql://moc_test@localhost/postgres?host=${encodeURIComponent(directory)}`;
  const diagnostic = JSON.parse(execFileSync("node_modules/.bin/tsx", ["scripts/diagnose-neon-egress.ts"], {
    env: { ...process.env, DATABASE_URL: diagnosticUrl, DATABASE_URL_UNPOOLED: diagnosticUrl }, encoding: "utf8",
  }));
  assert.equal(diagnostic.sizes[0]?.tasks, state.tasks.length);
  assert.equal(diagnostic.statisticsAvailable, false, "fresh local PG intentionally has no statement extension");
  assert(!JSON.stringify(diagnostic).includes(state.users[0]!.email), "diagnostics must not print private records");
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

  const admin = full.users.find((user) => user.approved && user.isLeader && user.department === "cell-0")!;
  const liveRows = async (memberId: string) => (await pool!.query(workspaceLiveSql, ["egress-verification", memberId])).rows;
  assert.deepEqual(await liveRows(admin.id), [{ id: "egress-verification", revision: "0" }]);
  const soundTask = full.tasks.find((task) => task.department === "sound")!;
  assert(soundTask);
  await repository.update((current) => ({ ...current, tasks: current.tasks.map((task) => task.id === soundTask.id ? { ...task, status: "completed" } : task) }));
  assert.equal((await liveRows(admin.id))[0]?.revision, "0", "status changes must not create a live signal");
  await repository.update((current) => createRequest(current, {
    ministry: current.catalog.ministries[0]!, service: current.catalog.services.find((service) => !service.requiresAiredDates)!.id,
    title: "Priority live request", instructions: "Local verification", notes: "Temporary local fixture", dueAt: new Date(Date.now() + 7 * 86400000).toISOString(),
  }).state);
  assert.equal((await liveRows(admin.id))[0]?.revision, "1", "new requests must notify Cell 0 leaders");
  const soundMember = full.users.find((user) => user.department === "sound" && user.approved)!;
  const designMember = full.users.find((user) => user.department === "design" && user.approved)!;
  assert.equal((await liveRows(soundMember.id))[0]?.revision, "0", "new requests must not notify unrelated departments");
  await repository.update((current) => applyAction(current, admin, { type: "add-note", taskId: soundTask.id, text: "Priority live comment" }));
  assert.equal((await liveRows(admin.id))[0]?.revision, "2");
  assert.equal((await liveRows(soundMember.id))[0]?.revision, "1", "task comments must notify their department");
  assert.equal((await liveRows(designMember.id))[0]?.revision, "0", "private comments must not signal other departments");
  const beforeFailedWrite = await repository.read();
  await pool.query("ALTER TABLE moc.workspace_members ADD CONSTRAINT test_signal_rollback CHECK (live_revision <= 2)");
  await assert.rejects(repository.update((current) => applyAction(current, admin, { type: "add-note", taskId: soundTask.id, text: "Must roll back" })));
  assert.deepEqual(await repository.read(), beforeFailedWrite, "failed signal writes must roll back the comment transaction");
  assert.equal((await liveRows(admin.id))[0]?.revision, "2");
  await pool.query("ALTER TABLE moc.workspace_members DROP CONSTRAINT test_signal_rollback");
  await repository.update((current) => ({ ...current, users: current.users.map((user) => user.id === member.id ? { ...user, approved: false } : user) }));
  assert.equal(await repository.findApprovedLeaderById(member.id), null, "revocation must take effect immediately");
  assert.equal(await repository.findApprovedLeaderByGoogleEmail(member.email), null);
  assert.deepEqual(await liveRows(member.id), [], "revoked members must immediately disappear from the live query");
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
    checks: ["projection shapes", "parameterized member lookup", "immediate revocation", "membership write suppression", "legacy normalization", "priority-only live SQL", "private comment audience", "atomic signal rollback", "read-only metadata diagnostic", "deferred schema upgrade preserves members"],
  };
  await mkdir("output/playwright/egress", { recursive: true });
  await writeFile("output/playwright/egress/postgres-verification.json", JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result));
} finally {
  await pool?.end();
  if (started) execFileSync("pg_ctl", ["-D", dataDirectory, "-m", "fast", "-w", "stop"], { stdio: "ignore" });
  await rm(directory, { recursive: true, force: true });
}
