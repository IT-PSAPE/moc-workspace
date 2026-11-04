import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, mkdir } from "node:fs/promises";
import { Pool } from "pg";
import { chromium } from "playwright";
import { createSeedState } from "@moc/shared";
import { PostgresRepository } from "../apps/api/src/postgres-repository";

// Provider-contract test, not a claim of live Google/Supabase verification.
// Real Postgres, SDK, API, browser cookies, proxy and Storage client; only the
// external Auth/Storage provider is replaced with a local HTTP fixture.
const directory = await mkdtemp("/tmp/moc-supabase-");
const data = `${directory}/postgres`;
const processes: ReturnType<typeof spawn>[] = [];
let pool: Pool | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let postgresStarted = false;
const workspace = "http://localhost:5297";
const providerCalls: string[] = [];
const objects = new Map<string, Buffer>();
const state = createSeedState();
const member = state.users.find((user) => user.approved && user.isLeader && user.department === "cell-0")!;
let denied = false;
let challenge = "";
let activeToken = "";
const user = () => ({ id: "provider-identity", aud: "authenticated", role: "authenticated", email: denied ? "uninvited@example.com" : member.email, email_confirmed_at: new Date().toISOString(), identities: [{ id: "google-identity", provider: "google" }], app_metadata: { provider: "google" }, user_metadata: {} });
const provider = createServer(async (request, response) => {
  const url = new URL(request.url!, "http://localhost");
  const send = (status: number, body: unknown) => { response.writeHead(status, { "content-type": "application/json" }); response.end(JSON.stringify(body)); };
  providerCalls.push(`${request.method} ${url.pathname}`);
  const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const bytes = Buffer.concat(chunks);
  if (url.pathname === "/auth/v1/authorize") {
    challenge = url.searchParams.get("code_challenge")!;
    assert(challenge);
    const callback = new URL(url.searchParams.get("redirect_to")!);
    callback.searchParams.set("code", "provider-code");
    response.writeHead(302, { location: callback.href }); response.end(); return;
  }
  if (url.pathname === "/auth/v1/token") {
    const body = JSON.parse(bytes.toString());
    if (url.searchParams.get("grant_type") === "pkce") {
      if (body.auth_code !== "provider-code" || createHash("sha256").update(body.code_verifier || "").digest("base64url") !== challenge) return send(400, { error: "invalid_grant", message: "Invalid verifier" });
    }
    activeToken = [Buffer.from('{"alg":"HS256","typ":"JWT"}').toString("base64url"), Buffer.from(JSON.stringify({ sub: user().id, aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000) })).toString("base64url"), "fixture-signature"].join(".");
    return send(200, { access_token: activeToken, refresh_token: "private-refresh", token_type: "bearer", expires_in: 3600, user: user() });
  }
  if (url.pathname === "/auth/v1/user") return request.headers.authorization === `Bearer ${activeToken}` ? send(200, user()) : send(401, { message: "Invalid token" });
  if (url.pathname === "/auth/v1/logout") { response.writeHead(204); response.end(); return; }
  if (url.pathname.startsWith("/storage/v1/object/")) {
    if (request.headers.apikey !== "fixture-secret") return send(403, { message: "Server key required" });
    const key = url.pathname.replace("/storage/v1/object/", "");
    if (request.method === "POST") { objects.set(key, bytes); return send(200, { Key: key }); }
    if (request.method === "GET" && objects.has(key)) { response.writeHead(200, { "content-type": "text/csv" }); response.end(objects.get(key)); return; }
  }
  return send(404, { message: "Fixture endpoint unavailable" });
});
async function start(command: string, args: string[], env: NodeJS.ProcessEnv, ready: RegExp, cwd = process.cwd()) {
  const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] }); processes.push(child);
  let logs = "";
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Test service did not start: ${logs}`)), 15_000);
    child.stderr!.on("data", (chunk) => { logs += chunk; });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("exit", () => { clearTimeout(timer); reject(new Error(`Test service exited: ${logs}`)); });
    child.stdout!.on("data", (chunk) => { logs += chunk; const match = logs.match(ready); if (match) { clearTimeout(timer); resolve(match[0]); } });
  });
}
try {
  execFileSync("initdb", ["-D", data, "-A", "trust", "-U", "moc_test", "--no-locale"], { stdio: "ignore" });
  execFileSync("pg_ctl", ["-D", data, "-l", `${directory}/postgres.log`, "-o", `-k ${directory} -c listen_addresses=''`, "-w", "start"], { stdio: "ignore" }); postgresStarted = true;
  const database = `postgresql://moc_test@localhost/postgres?host=${encodeURIComponent(directory)}`;
  pool = new Pool({ connectionString: database, max: 2 });
  const migrations = new URL("../supabase/migrations/", import.meta.url);
  for (const file of (await readdir(migrations)).filter((name) => name.endsWith(".sql")).sort()) await pool.query(await readFile(new URL(file, migrations), "utf8"));
  await new PostgresRepository(pool).initialize(state);
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  const providerPort = (provider.address() as { port: number }).port;
  const api = await start("node_modules/.bin/tsx", ["apps/api/src/server.ts"], {
    NODE_ENV: "development", PORT: "0", WORKSPACE_URL: workspace, API_ALLOWED_ORIGINS: workspace,
    SUPABASE_DATABASE_URL: database, SUPABASE_URL: `http://127.0.0.1:${providerPort}`, SUPABASE_PUBLISHABLE_KEY: "fixture-publishable", SUPABASE_SECRET_KEY: "fixture-secret", TELEGRAM_BOT_TOKEN: "",
  }, /http:\/\/localhost:\d+/);
  await start(`${process.cwd()}/node_modules/.bin/vite`, ["--host", "localhost", "--port", "5297", "--strictPort"], { VITE_API_URL: "", API_PROXY_TARGET: api }, /http:\/\/localhost:5297/, `${process.cwd()}/apps/workspace`);
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "chrome" });
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    const errors: string[] = [];
    const directProviderFetches: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => { if (["fetch", "xhr", "websocket"].includes(request.resourceType()) && new URL(request.url()).origin !== workspace) directProviderFetches.push(request.url()); });
    await page.goto(`${workspace}/login`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Continue with Google" }).click();
    await page.getByRole("heading", { name: /Good (morning|afternoon|evening)/ }).waitFor();
    const cookies = (await context.cookies()).filter((cookie) => cookie.name.startsWith("moc_auth"));
    assert(cookies.some((cookie) => cookie.name === "moc_auth"));
    assert(cookies.every((cookie) => cookie.httpOnly && cookie.sameSite === "Lax"));
    assert.equal(await page.evaluate(() => Object.keys(localStorage).some((key) => /supabase|auth|token/i.test(key))), false);
    assert.equal(await page.evaluate(() => document.cookie.includes("moc_auth")), false);
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("heading", { name: /Good (morning|afternoon|evening)/ }).waitFor();
    const exported = await context.request.post(`${workspace}/api/reports/export`, { headers: { origin: workspace }, data: { month: "2026-11", csv: "Task,Status\r\nContract,Completed" } });
    assert.equal(exported.status(), 201);
    const report = await exported.json();
    assert(report.url.startsWith("/api/reports/"));
    const download = await context.request.get(`${workspace}${report.url}`);
    assert.equal(download.status(), 200); assert.equal(await download.text(), "Task,Status\r\nContract,Completed");
    await mkdir("output/playwright/supabase", { recursive: true });
    await page.screenshot({ path: `output/playwright/supabase/${width}-authenticated.png`, fullPage: true });
    const logout = await context.request.post(`${workspace}/api/auth/logout`, { headers: { origin: workspace } });
    assert.equal(logout.status(), 200);
    assert.deepEqual(await (await context.request.get(`${workspace}/api/session`)).json(), { user: null, demo: false });
    assert.equal((await context.request.get(`${workspace}${report.url}`)).status(), 401);
    denied = true;
    await page.goto(`${workspace}/login`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Continue with Google" }).click();
    await page.getByRole("alert").getByText(/not an approved member/).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `output/playwright/supabase/${width}-denied.png`, fullPage: true });
    assert.deepEqual(directProviderFetches, [], "all application fetches go through same-origin API");
    assert.deepEqual(errors, []);
    denied = false;
    await context.close();
    console.log(`PASS ${width}px: same-origin OAuth PKCE, HttpOnly session, reload, API private report bytes, logout, denied identity, no browser provider fetches or page errors`);
  }
  assert(providerCalls.some((path) => path === "POST /auth/v1/token"));
  assert(providerCalls.some((path) => path.startsWith("POST /storage/v1/object/")));
} finally {
  await browser?.close();
  for (const child of processes) child.kill("SIGTERM");
  await Promise.all(processes.map((child) => new Promise<void>((resolve) => { if (child.exitCode !== null || child.signalCode !== null) return resolve(); child.once("exit", () => resolve()); setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 2000).unref(); })));
  provider.closeAllConnections(); await new Promise<void>((resolve) => provider.close(() => resolve()));
  await pool?.end();
  if (postgresStarted) execFileSync("pg_ctl", ["-D", data, "-m", "fast", "-w", "stop"], { stdio: "ignore" });
  await rm(directory, { recursive: true, force: true });
}
