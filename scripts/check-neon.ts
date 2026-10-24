import "../apps/api/src/load-env";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";
import { Pool } from "pg";
import { serve } from "@hono/node-server";
import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { bannerQuoteDate, createRequest, currentBannerQuote, type WorkspaceState } from "@moc/shared";
import { PostgresRepository, emptyWorkspace } from "../apps/api/src/postgres-repository";
import { createApiApp } from "../apps/api/src/index";
import { neonSessionResolver } from "../apps/api/src/neon-auth";
import { NeonReportStorage } from "../apps/api/src/report-storage";
import { workspaceRealtime } from "../apps/api/src/realtime";
import { createRealtimeClient } from "@neon/realtime/client";

// Isolated persistence tests plus temporary, uniquely named live API fixtures.
const workspaceId = `verify-${randomUUID()}`;
const email = `${workspaceId}@example.invalid`;
const password = randomBytes(24).toString("base64url");
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
const repository = new PostgresRepository(pool, workspaceId);
const authUrl = process.env.NEON_AUTH_BASE_URL!;
const functionUrl = process.env.VERIFY_API_URL ?? process.env.NEON_FUNCTION_HELLO_BASE_URL!;
assert(authUrl && functionUrl, "Pull the Neon services first, and configure a deployed API URL.");
const origin = process.env.VERIFY_WORKSPACE_ORIGIN ?? "http://localhost:5173";
assert(!process.argv.includes("--browser") || new URL(origin).hostname === "localhost", "The optional development-SDK browser harness requires localhost; use the real Google flow on production.");
let cookies = "";
let authId: string | undefined;
let server: ReturnType<typeof serve> | undefined;
let exportedKey: string | undefined;
const productionRepository = new PostgresRepository(pool);
let liveMemberAdded = false;
let liveRequestId: string | undefined;
let liveReference: string | undefined;
let liveExportId: string | undefined;
let liveExportKey: string | undefined;
let liveQuoteId: string | undefined;

async function auth(path: string, body?: unknown) {
  const response = await fetch(`${authUrl}/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { origin, "content-type": "application/json", ...(cookies ? { cookie: cookies } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const set = response.headers.getSetCookie();
  if (set.length) cookies = set.map((value) => value.split(";")[0]).join("; ");
  const result = await response.json();
  assert(response.ok, `Auth ${path}: HTTP ${response.status}, ${result?.message ?? result?.error ?? "failed"}`);
  return result;
}

async function verifyRealtime(apiUrl: string, target: PostgresRepository, token: string, revoke: () => Promise<unknown>) {
  const liveSeal = await fetch(`${apiUrl}/api/workspace/live`, { method: "POST", headers: { origin, authorization: `Bearer ${token}` } });
  assert.equal(liveSeal.status, 200);
  const realtimeClient = createRealtimeClient({ url: process.env.NEON_REALTIME_URL! });
  const subscription = realtimeClient.subscribe<{ id: string; revision: string }>(await liveSeal.json());
  const waitForRevision = (predicate: (data: readonly { id: string; revision: string }[]) => boolean) => new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => { remove(); reject(new Error("Realtime update did not arrive within 20 seconds")); }, 20_000);
    const check = (snapshot: ReturnType<typeof subscription.getSnapshot>) => {
      if (snapshot.status === "error") { clearTimeout(timeout); remove(); reject(snapshot.error); }
      else if (snapshot.data && predicate(snapshot.data)) { clearTimeout(timeout); remove(); resolve(); }
    };
    const remove = subscription.onChange(check);
    check(subscription.getSnapshot());
  });
  try {
    await waitForRevision((data) => data.length === 1);
    const before = subscription.getSnapshot().data![0].revision;
    await target.update((current) => current);
    await waitForRevision((data) => data[0]?.revision !== before);
    await revoke();
    await waitForRevision((data) => data.length === 0);
  } finally { subscription.unsubscribe(); realtimeClient.close(); }
}

try {
  const state = emptyWorkspace();
  state.users.push({ id: workspaceId, name: "Neon verification", email, duty: "Test", department: "cell-0", groups: ["Cell 0"], isLeader: true, approved: true });
  await repository.initialize(state);
  const input = { ministry: state.catalog.ministries[0], service: state.catalog.services.find((service) => !service.requiresAiredDates)!.id, title: "Neon verification request", instructions: "Isolated integration test", notes: "Temporary verification fixture", dueAt: new Date(Date.now() + 7 * 86400000).toISOString() };
  await Promise.all(Array.from({ length: 5 }, () => repository.update((current) => createRequest(current, input).state)));
  const stored = await new PostgresRepository(pool, workspaceId).read();
  assert.equal(stored.requests.length, 5);
  assert.equal(new Set(stored.requests.map((request) => request.reference)).size, 5);
  await assert.rejects(repository.update(() => { throw new Error("deliberate rollback"); }));
  assert.deepEqual(await repository.read(), stored);
  console.log("PASS Postgres: persistence, five concurrent unique references, transaction rollback");

  const app = createApiApp(repository, { resolveSession: neonSessionResolver(repository, pool), reportStorage: new NeonReportStorage(pool, workspaceId), storage: "neon-postgres", sealWorkspace: workspaceRealtime(workspaceId) });
  server = serve({ fetch: app.fetch, port: 0 });
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  const apiUrl = `http://localhost:${address.port}`;
  const workspace = (token?: string) => fetch(`${apiUrl}/api/workspace`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  assert.equal((await workspace()).status, 401);
  assert.equal((await workspace("forged-token")).status, 401);
  const signup = await auth("sign-up/email", { email, password, name: "Neon verification" });
  authId = signup.user?.id;
  assert(authId, "Signup created a managed Auth identity");
  await auth("sign-out", {});
  cookies = "";
  await auth("sign-in/email", { email, password });
  const unverifiedToken = (await auth("token")).token;
  assert.equal((await workspace(unverifiedToken)).status, 401);
  // Only our reserved test identity is marked verified; production Auth policy is untouched.
  await pool.query('UPDATE neon_auth."user" SET "emailVerified" = true WHERE id = $1 AND email = $2', [authId, email]);
  const session = await auth("get-session");
  assert.equal(session.user.id, authId);
  const token = (await auth("token")).token;
  const authorized = await workspace(token);
  assert.equal(authorized.status, 200, `Verified identity workspace HTTP ${authorized.status}`);
  assert.equal((await authorized.json()).users[0].email, email);
  console.log("PASS Neon Auth: signup, signin, restored session, signed JWT, verified member authorization; missing/forged/unverified identities rejected");

  const csv = 'Task,Status\r\n"Neon verification",Completed';
  const response = await fetch(`${apiUrl}/api/reports/export`, { method: "POST", headers: { origin, "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ month: "2026-10", csv }) });
  assert.equal(response.status, 201, `Export HTTP ${response.status}: ${response.status === 201 ? "" : await response.text()}`);
  const exported = await response.json();
  const row = await pool.query("SELECT object_key FROM moc.report_exports WHERE id = $1 AND workspace_id = $2", [exported.id, workspaceId]);
  exportedKey = row.rows[0]?.object_key;
  assert(exportedKey);
  const download = await fetch(exported.url);
  assert.equal(download.status, 200);
  assert.equal(await download.text(), csv);
  const unsigned = new URL(exported.url); unsigned.search = "";
  assert([401, 403].includes((await fetch(unsigned)).status), "Private report requires a signature");
  console.log("PASS Object Storage: authenticated report API -> private bucket + Postgres metadata -> signed download, exact CSV roundtrip; anonymous download denied");

  const root = functionUrl.replace(/\/$/, "");
  assert.equal((await fetch(`${root}/health`)).status, 200);
  const catalog = await fetch(`${root}/api/catalog`);
  assert.equal(catalog.status, 200);
  assert((await catalog.json()).services.length > 0);
  assert.equal((await fetch(`${root}/api/workspace`)).status, 401);
  assert.equal((await fetch(`${root}/api/workspace`, { headers: { authorization: "Bearer forged-token" } })).status, 401);
  assert.equal((await fetch(`${root}/api/auth/demo`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ department: "cell-0" }) })).status, 403);
  const preflight = await fetch(`${root}/api/actions`, { method: "OPTIONS", headers: { origin, "access-control-request-method": "POST", "access-control-request-headers": "authorization,content-type" } });
  assert.equal(preflight.headers.get("access-control-allow-origin"), origin);
  assert(preflight.headers.get("access-control-allow-headers")?.toLowerCase().includes("authorization"));
  console.log("PASS deployed API: health 200, live Postgres catalog 200, private routes 401, demo signin 403, bearer-token CORS");

  // Exercise the deployed handler with a real managed identity. The only access
  // added is for this random test identity; the administrator's record is preserved.
  await productionRepository.update((current) => ({ ...current, users: [...current.users, state.users[0]] }));
  liveMemberAdded = true;
  const headers = { origin, "content-type": "application/json", authorization: `Bearer ${token}` };
  const liveWorkspace = await fetch(`${root}/api/workspace`, { headers });
  assert.equal(liveWorkspace.status, 200);
  const liveState = await liveWorkspace.json() as WorkspaceState;
  assert.equal(liveState.bannerQuotes?.daily?.date, bannerQuoteDate());
  const todayBefore = currentBannerQuote(liveState.bannerQuotes);
  const createQuote = await fetch(`${root}/api/actions`, { method: "POST", headers, body: JSON.stringify({
    type: "save-banner-quote", quote: { text: workspaceId, author: "Temporary Neon verification" },
  }) });
  assert.equal(createQuote.status, 200);
  const quoteState = await createQuote.json() as WorkspaceState;
  liveQuoteId = quoteState.bannerQuotes?.quotes.find((quote) => quote.text === workspaceId)?.id;
  assert(liveQuoteId);
  const editQuote = await fetch(`${root}/api/actions`, { method: "POST", headers, body: JSON.stringify({
    type: "save-banner-quote", quote: { id: liveQuoteId, text: `${workspaceId}-edited`, author: "Temporary Neon verification" },
  }) });
  assert.equal(editQuote.status, 200);
  const quoteStored = await productionRepository.read();
  assert.equal(quoteStored.bannerQuotes?.quotes.find((quote) => quote.id === liveQuoteId)?.text, `${workspaceId}-edited`);
  assert.deepEqual(currentBannerQuote(quoteStored.bannerQuotes), todayBefore);
  const deleteQuote = await fetch(`${root}/api/actions`, { method: "POST", headers, body: JSON.stringify({ type: "delete-banner-quotes", quoteIds: [liveQuoteId] }) });
  assert.equal(deleteQuote.status, 200);
  assert(!(await productionRepository.read()).bannerQuotes?.quotes.some((quote) => quote.id === liveQuoteId));
  liveQuoteId = undefined;
  console.log("PASS live banner quotes: authenticated API -> create/edit -> Neon persistence -> bulk delete; today's banner stays unchanged");
  const submit = await fetch(`${root}/api/requests`, { method: "POST", headers, body: JSON.stringify({ ...input, title: workspaceId }) });
  assert.equal(submit.status, 201);
  const receipt = await submit.json();
  liveRequestId = receipt.request.id;
  liveReference = receipt.request.reference;
  const persisted = (await productionRepository.read()).requests.find((request) => request.id === liveRequestId);
  assert(persisted?.trackingCodeHash && !JSON.stringify(persisted).includes(receipt.trackingCode));
  const approve = await fetch(`${root}/api/actions`, { method: "POST", headers, body: JSON.stringify({ type: "approve", requestId: liveRequestId }) });
  assert.equal(approve.status, 200);
  const approved = await approve.json();
  const task = approved.tasks.find((task: { requestId?: string }) => task.requestId === liveRequestId);
  assert(task);
  // Task updates belong to the assigned department. Change only this fixture's
  // membership to exercise the real department authorization contract.
  await productionRepository.update((current) => ({ ...current, users: current.users.map((user) => user.id === workspaceId ? { ...user, department: task.department, groups: [task.subTeam] } : user) }));
  for (const status of ["in-progress", "completed"]) {
    assert.equal((await fetch(`${root}/api/actions`, { method: "POST", headers, body: JSON.stringify({ type: "update-task", taskId: task.id, status }) })).status, 200);
  }
  const tracking = await fetch(`${root}/api/track`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ code: receipt.trackingCode }) });
  assert.equal(tracking.status, 200);
  assert.equal((await tracking.json()).task.status, "completed");
  await productionRepository.update((current) => ({ ...current, users: current.users.map((user) => user.id === workspaceId ? state.users[0] : user) }));
  const liveExport = await fetch(`${root}/api/reports/export`, { method: "POST", headers, body: JSON.stringify({ month: "2026-10", csv }) });
  assert.equal(liveExport.status, 201);
  const liveFile = await liveExport.json();
  liveExportId = liveFile.id;
  liveExportKey = (await pool.query("SELECT object_key FROM moc.report_exports WHERE id = $1", [liveExportId])).rows[0].object_key;
  assert.equal(await (await fetch(liveFile.url)).text(), csv);
  console.log("PASS live API end to end: managed JWT -> approved membership -> submit -> Postgres -> approve -> start -> complete -> private-code tracking; authenticated report -> private storage -> exact signed download");

  if (process.argv.includes("--browser")) {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ channel: "chrome", headless: true });
    let browserPage: Awaited<ReturnType<typeof browser.newPage>> | undefined;
    try {
      const page = await browser.newPage({ acceptDownloads: true });
      browserPage = page;
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(origin);
      const authModulePath = `/@fs${fileURLToPath(new URL("../packages/client/src/auth.ts", import.meta.url))}`;
      await page.evaluate(async ({ path, email, password }) => {
        const { neonAuth } = await import(path);
        const { error } = await neonAuth.signIn.email({ email, password });
        if (error) throw new Error(error.message);
      }, { path: authModulePath, email, password });
      await page.goto(`${origin}/reports`);
      await page.getByRole("button", { name: "Export CSV", exact: true }).waitFor();
      await page.reload();
      await page.getByRole("button", { name: "Export CSV", exact: true }).waitFor();
      const liveTitle = `${workspaceId}-live`;
      await productionRepository.update((current) => ({ ...current, tasks: current.tasks.map((item) => item.id === task.id ? { ...item, title: liveTitle } : item) }));
      await page.getByText(liveTitle, { exact: true }).waitFor({ timeout: 20_000 });
      const downloadPromise = page.waitForEvent("download");
      await page.getByRole("button", { name: "Export CSV", exact: true }).click();
      const download = await downloadPromise;
      const { readFile } = await import("node:fs/promises");
      const file = await download.path();
      assert(file && (await readFile(file, "utf8")).includes(workspaceId));
      await mkdir("output/playwright/neon", { recursive: true });
      await page.screenshot({ path: "output/playwright/neon/reports.png", fullPage: true });
      await page.evaluate(async (path) => {
        const { neonAuth } = await import(path);
        const { error } = await neonAuth.signOut();
        if (error) throw new Error(error.message);
      }, authModulePath);
      await page.goto(origin);
      await page.getByRole("button", { name: "Continue with Google", exact: true }).waitFor();
      assert.deepEqual(errors, []);
      console.log("PASS browser: real Neon SDK signin, protected Reports, session reload, external write -> Realtime -> visible table update without reload, Export CSV -> private storage download, signout; no page errors");
    } catch (error) {
      if (browserPage) {
        await mkdir("output/playwright/neon", { recursive: true });
        await browserPage.screenshot({ path: "output/playwright/neon/browser-failure.png", fullPage: true });
        console.error("Browser verification location:", browserPage.url());
        console.error("Browser visible state:", (await browserPage.locator("body").innerText()).slice(0, 1500));
      }
      throw error;
    } finally { await browser.close(); }
  }

  await verifyRealtime(root, productionRepository, token, () => productionRepository.update((current) => ({
    ...current, users: current.users.map((user) => user.id === workspaceId ? { ...user, approved: false } : user),
  })));
  console.log("PASS deployed API Realtime: managed JWT -> authenticated sealed query -> WebSocket snapshot -> committed revision -> only verification member revoked -> live rows removed");
  await verifyRealtime(apiUrl, repository, token, () => repository.update((current) => ({ ...current, users: [] })));
  console.log("PASS isolated Realtime: authenticated sealed query -> live WebSocket snapshot -> committed revision update -> immediate membership revocation removes live rows");

  await auth("sign-out", {});
  cookies = "";
  assert.equal(await auth("get-session"), null);
  assert.equal((await workspace(token)).status, 401, "Removing workspace membership denies an otherwise valid JWT");
  console.log("PASS signout and immediate workspace access revocation");
} finally {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  const storedExports = await pool.query("SELECT id, object_key FROM moc.report_exports WHERE member_id = $1", [workspaceId]);
  const cleanupStorage = new S3Client({ forcePathStyle: true });
  for (const item of storedExports.rows) {
    await cleanupStorage.send(new DeleteObjectCommand({ Bucket: "assets", Key: item.object_key }));
    await pool.query("DELETE FROM moc.report_exports WHERE id = $1 AND member_id = $2", [item.id, workspaceId]);
  }
  if (liveQuoteId) await productionRepository.update((current) => ({ ...current, bannerQuotes: current.bannerQuotes
    ? { ...current.bannerQuotes, quotes: current.bannerQuotes.quotes.filter((quote) => quote.id !== liveQuoteId) }
    : current.bannerQuotes }));
  if (liveMemberAdded) await productionRepository.update((current) => ({
    ...current,
    users: current.users.filter((user) => user.id !== workspaceId),
    requests: current.requests.filter((request) => request.id !== liveRequestId),
    tasks: current.tasks.filter((task) => !liveRequestId || task.requestId !== liveRequestId),
    activities: current.activities.filter((activity) => !activity.text.includes(workspaceId) && !(liveReference && activity.text.includes(liveReference))),
    notifications: current.notifications.filter((notification) => !notification.text.includes(workspaceId) && !(liveReference && notification.text.includes(liveReference))),
  }));
  await pool.query("DELETE FROM moc.workspace_state WHERE id = $1", [workspaceId]);
  if (authId) await pool.query('DELETE FROM neon_auth."user" WHERE id = $1 AND email = $2', [authId, email]);
  await pool.end();
  console.log("PASS cleanup: only isolated verification records and objects removed");
}

// The experimental Realtime SDK can retain retry timers after close().
// All owned resources have been awaited and cleaned above.
process.exit(0);
