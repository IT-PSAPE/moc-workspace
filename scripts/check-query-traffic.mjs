import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { startUiTestApi } from "./ui-test-server.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "output/playwright/egress");
const workspaceUrl = "http://localhost:5293";
const portalUrl = "http://localhost:5294";
const processes = [];
let isolated;
let browser;

async function startVite(app, port) {
  const child = spawn(path.join(root, "node_modules/.bin/vite"), ["--host", "localhost", "--port", String(port), "--strictPort"], {
    cwd: path.join(root, "apps", app),
    env: { ...process.env, VITE_API_URL: isolated.url, VITE_PORTAL_URL: portalUrl, VITE_WORKSPACE_URL: workspaceUrl },
    stdio: ["ignore", "pipe", "pipe"],
  });
  processes.push(child);
  let logs = "";
  child.stderr.on("data", (chunk) => { logs += chunk; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Vite did not start: ${logs}`)), 15000);
    child.once("error", reject);
    child.once("exit", () => { clearTimeout(timer); reject(new Error(`Vite exited: ${logs}`)); });
    child.stdout.on("data", (chunk) => {
      logs += chunk;
      if (logs.includes(`localhost:${port}`)) { clearTimeout(timer); resolve(); }
    });
  });
}

async function tick(page, milliseconds) {
  // Let real HTTP requests settle between virtual timer ticks.
  for (let elapsed = 0; elapsed < milliseconds; elapsed += 60000) {
    await page.clock.runFor(Math.min(60000, milliseconds - elapsed));
    await new Promise((resolve) => setTimeout(resolve, 25));
    await page.waitForLoadState("networkidle");
  }
}

try {
  await mkdir(output, { recursive: true });
  isolated = await startUiTestApi([workspaceUrl, portalUrl]);
  await startVite("workspace", 5293);
  await startVite("portal", 5294);
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "chrome" });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  const counts = {};
  context.on("page", (page) => {
    page.on("pageerror", (error) => { errors.push(error.message); console.error(error.message); });
    page.on("console", (message) => { if (message.type() === "error") console.error(message.text()); });
  });
  context.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin === isolated.url && url.pathname.startsWith("/api/")) counts[url.pathname] = (counts[url.pathname] || 0) + 1;
  });
  await context.addInitScript(() => {
    window.__mocLive = { status: "live", data: [{ id: "moc", revision: "1" }] };
    window.__mocVisible = true;
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => window.__mocVisible ? "visible" : "hidden" });
    // Mock only the API stream transport; exercise the actual client SSE parser
    // and leave every workspace read and mutation on the real isolated API.
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input, options) => {
      if (new URL(typeof input === "string" ? input : input.url, location.origin).pathname !== "/api/workspace/events") return nativeFetch(input, options);
      window.__mocLiveSubscriptions = (window.__mocLiveSubscriptions || 0) + 1;
      let closed = false;
      let controller;
      const send = () => {
        if (closed) return;
        const live = window.__mocLive;
        const event = live.status === "error" ? "paused" : !live.data?.length ? "revoked" : "revision";
        const data = event === "revision" ? live.data[0] : {};
        controller.enqueue(new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      const close = () => {
        if (closed) return;
        closed = true; window.__mocLiveSubscriptions -= 1;
        window.removeEventListener("moc-live", send);
        controller.close();
      };
      const body = new ReadableStream({ start(value) { controller = value; window.addEventListener("moc-live", send); send(); }, cancel() { close(); } });
      options?.signal?.addEventListener("abort", close, { once: true });
      return new Response(body, { headers: { "content-type": "text/event-stream" } });
    };
  });
  const page = await context.newPage();
  await page.clock.install({ time: new Date("2026-10-29T10:00:00+02:00") });
  await page.goto(`${workspaceUrl}/settings`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Settings", exact: true }).waitFor();
  const initial = counts["/api/workspace"];
  await tick(page, 65000);
  assert.equal(counts["/api/workspace"], initial, "healthy Realtime must not poll the workspace while idle");
  const stored = await (await context.request.get(`${isolated.url}/api/workspace`)).json();
  const member = stored.users.find((user) => user.name === "Grace Ndlovu");
  assert(member);
  const changed = await context.request.post(`${isolated.url}/api/actions`, {
    headers: { origin: workspaceUrl },
    data: { type: "update-member", userId: member.id, changes: { name: "Grace Egress Check" } },
  });
  assert(changed.ok());
  assert.equal(await page.getByText("Grace Egress Check", { exact: true }).count(), 0, "ordinary edits are not pushed immediately");
  await tick(page, 840000);
  await page.getByText("Grace Egress Check", { exact: true }).waitFor();
  assert.equal(counts["/api/workspace"], initial + 1, "non-priority changes refresh every fifteen minutes while Realtime is connected");
  const beforePriority = counts["/api/workspace"];

  await page.getByRole("link", { name: "Requests", exact: true }).click();
  await page.getByRole("heading", { name: "Requests", exact: true }).waitFor();
  const created = await context.request.post(`${isolated.url}/api/requests`, {
    headers: { origin: workspaceUrl },
    data: {
      ministry: stored.catalog.ministries[0], service: stored.catalog.services.find((service) => !service.requiresAiredDates).id,
      title: "Priority live request", instructions: "Verify targeted live delivery", notes: "Isolated verification",
      dueAt: new Date(Date.now() + 7 * 86400000).toISOString(),
    },
  });
  assert(created.ok());
  const receipt = await created.json();
  assert.equal(await page.getByRole("button", { name: "Open Priority live request", exact: true }).count(), 0);
  const revisionResponse = page.waitForResponse((response) => response.url() === `${isolated.url}/api/workspace`);
  await page.evaluate(() => { window.__mocLive = { status: "live", data: [{ id: "moc", revision: "2" }] }; window.dispatchEvent(new Event("moc-live")); });
  await revisionResponse;
  await page.getByRole("button", { name: "Open Priority live request", exact: true }).waitFor();
  await page.waitForLoadState("networkidle");
  assert.equal(counts["/api/workspace"], beforePriority + 1, "a priority signal refreshes the workspace once");
  const beforeOpen = counts["/api/workspace"];
  await page.getByRole("button", { name: "Open Priority live request", exact: true }).click();
  await page.getByRole("heading", { name: "Request details", exact: true }).waitFor();
  await page.waitForLoadState("networkidle");
  assert.equal(counts["/api/workspace"], beforeOpen, "opening cached details must not fetch the whole workspace again");
  const posted = await context.request.post(`${isolated.url}/api/actions`, {
    headers: { origin: workspaceUrl }, data: { type: "add-request-note", requestId: receipt.request.id, text: "Immediate priority comment" },
  });
  assert(posted.ok());
  const commentResponse = page.waitForResponse((response) => response.url() === `${isolated.url}/api/workspace`);
  await page.evaluate(() => { window.__mocLive = { status: "live", data: [{ id: "moc", revision: "3" }] }; window.dispatchEvent(new Event("moc-live")); });
  await commentResponse;
  await page.getByText("Immediate priority comment", { exact: true }).waitFor();
  await page.screenshot({ path: path.join(output, "priority-comments-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("textbox", { name: "Add a comment", exact: true }).fill("My own comment is immediate");
  const beforeOwnComment = counts["/api/workspace"];
  let releaseSave;
  const saveGate = new Promise((resolve) => { releaseSave = resolve; });
  await context.route(`${isolated.url}/api/actions?response=changes`, async (route) => { await saveGate; await route.continue(); });
  const ownResponse = page.waitForResponse((response) => response.url() === `${isolated.url}/api/actions?response=changes`);
  ownResponse.catch(() => {});
  await page.getByRole("button", { name: "Post comment", exact: true }).click();
  await page.locator("p").filter({ hasText: /^My own comment is immediate$/ }).waitFor();
  await page.getByRole("button", { name: "Posting…", exact: true }).waitFor();
  assert.equal(counts["/api/workspace"], beforeOwnComment, "optimistic changes appear before the save reaches the server");
  await page.screenshot({ path: path.join(output, "optimistic-comment-pending-mobile.png"), fullPage: true });
  releaseSave();
  const acknowledgement = await (await ownResponse).json();
  assert.equal(acknowledgement.ok, true);
  assert.equal(acknowledgement.tasks, undefined, "save responses must not include the full workspace");
  await page.getByRole("button", { name: "Post comment", exact: true }).waitFor();
  assert.equal(await page.locator("p").filter({ hasText: /^My own comment is immediate$/ }).count(), 1, "canonical confirmation must not duplicate optimistic comments");
  assert.equal(counts["/api/workspace"], beforeOwnComment, "successful saves require no follow-up workspace GET");
  await context.unroute(`${isolated.url}/api/actions?response=changes`);

  let rejectComment;
  const failureGate = new Promise((resolve) => { rejectComment = resolve; });
  await context.route(`${isolated.url}/api/actions?response=changes`, async (route) => {
    await failureGate;
    await route.fulfill({ status: 400, json: { error: "Test save failed. Please retry." } });
  });
  await page.getByRole("textbox", { name: "Add a comment", exact: true }).fill("Retry this comment");
  await page.getByRole("button", { name: "Post comment", exact: true }).click();
  await page.locator("p").filter({ hasText: /^Retry this comment$/ }).waitFor();
  // Live invalidation during a pending write is coalesced until settlement.
  await page.evaluate(() => { window.__mocLive = { status: "live", data: [{ id: "moc", revision: "pending-save" }] }; window.dispatchEvent(new Event("moc-live")); });
  await page.waitForTimeout(50);
  assert.equal(counts["/api/workspace"], beforeOwnComment);
  rejectComment();
  await page.getByText("Test save failed. Please retry.", { exact: true }).waitFor();
  await page.locator("p").filter({ hasText: /^Retry this comment$/ }).waitFor({ state: "detached" });
  assert.equal(await page.getByRole("textbox", { name: "Add a comment", exact: true }).inputValue(), "Retry this comment");
  await page.waitForLoadState("networkidle");
  assert.equal(counts["/api/workspace"], beforeOwnComment + 1, "failure/live signals coalesce into one reconciliation GET");
  await page.getByText("Test save failed. Please retry.", { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, "optimistic-comment-failed-mobile.png"), fullPage: true });
  await context.unroute(`${isolated.url}/api/actions?response=changes`);
  let confirmRetry;
  const retryGate = new Promise((resolve) => { confirmRetry = resolve; });
  await context.route(`${isolated.url}/api/actions?response=changes`, async (route) => { await retryGate; await route.continue(); });
  await page.getByRole("button", { name: "Post comment", exact: true }).click();
  await page.locator("p").filter({ hasText: /^Retry this comment$/ }).waitFor();
  const beforeDeferredSuccess = counts["/api/workspace"];
  await page.evaluate(() => { window.__mocLive = { status: "live", data: [{ id: "moc", revision: "successful-pending-save" }] }; window.dispatchEvent(new Event("moc-live")); });
  await page.waitForTimeout(50);
  assert.equal(counts["/api/workspace"], beforeDeferredSuccess);
  confirmRetry();
  await page.getByRole("button", { name: "Post comment", exact: true }).waitFor();
  await page.waitForLoadState("networkidle");
  assert.equal(counts["/api/workspace"], beforeDeferredSuccess + 1, "live invalidation must survive a successful cache confirmation");
  await context.unroute(`${isolated.url}/api/actions?response=changes`);
  await page.screenshot({ path: path.join(output, "priority-comments-mobile.png"), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goBack({ waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Settings", exact: true }).waitFor();
  await page.screenshot({ path: path.join(output, "live-settings-desktop.png"), fullPage: true });

  await page.evaluate(() => { window.__mocLive = { status: "error", data: undefined }; window.dispatchEvent(new Event("moc-live")); });
  await page.getByText("Live updates paused. Refresh to reconnect.").waitFor({ state: "attached" });
  const beforeFallback = counts["/api/workspace"];
  await tick(page, 65000);
  assert.equal(counts["/api/workspace"], beforeFallback, "a short visit must not trigger fallback polling");
  await tick(page, 840000);
  assert.equal(counts["/api/workspace"], beforeFallback + 1, "multiple settings observers must share one fallback refresh per fifteen minutes");
  const recoveryResponse = page.waitForResponse((response) => response.url() === `${isolated.url}/api/workspace`);
  await page.evaluate(() => { window.__mocLive = { status: "live", data: [{ id: "moc", revision: "4" }] }; window.dispatchEvent(new Event("moc-live")); });
  await recoveryResponse;
  await page.waitForLoadState("networkidle");
  const recovered = counts["/api/workspace"];
  await tick(page, 65000);
  assert.equal(counts["/api/workspace"], recovered, "reconnecting does not start faster polling");

  await page.evaluate(() => { window.__mocVisible = false; window.dispatchEvent(new Event("visibilitychange")); });
  await page.waitForFunction(() => window.__mocLiveSubscriptions === 0);
  const beforeBackground = { ...counts };
  await tick(page, 20 * 60000);
  assert.deepEqual(counts, beforeBackground, "hidden tabs must not poll or renew live subscriptions");
  const returnResponse = page.waitForResponse((response) => response.url() === `${isolated.url}/api/workspace`);
  await page.evaluate(() => { window.__mocVisible = true; window.dispatchEvent(new Event("visibilitychange")); });
  await returnResponse;
  await page.waitForFunction(() => window.__mocLiveSubscriptions === 1);
  await page.waitForLoadState("networkidle");
  await page.getByText("Grace Egress Check", { exact: true }).waitFor();

  await page.clock.setSystemTime(new Date("2026-10-29T23:59:58+02:00"));
  const boundaryResponse = page.waitForResponse((response) => response.url() === `${isolated.url}/api/workspace`);
  await page.evaluate(() => { window.__mocLive = { status: "live", data: [{ id: "moc", revision: "5" }] }; window.dispatchEvent(new Event("moc-live")); });
  await boundaryResponse;
  await page.waitForLoadState("networkidle");
  const beforeMidnight = counts["/api/workspace"];
  await tick(page, 3000);
  assert.equal(counts["/api/workspace"], beforeMidnight + 1, "the daily banner refresh still runs at Johannesburg midnight");

  await context.route(`${isolated.url}/api/session`, (route) => route.fulfill({ json: { user: null, demo: false } }));
  await page.evaluate(() => { window.__mocLive = { status: "live", data: [] }; window.dispatchEvent(new Event("moc-live")); });
  await page.getByRole("heading", { name: "Welcome back." }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(output, "revoked-login-mobile.png"), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, "mobile login must not overflow");

  const portal = await context.newPage();
  await portal.clock.install({ time: new Date("2026-10-29T10:00:00+02:00") });
  await portal.goto(portalUrl, { waitUntil: "networkidle" });
  const catalogs = counts["/api/catalog"];
  await tick(portal, 65000);
  assert.equal(counts["/api/catalog"], catalogs, "the public catalog stays cached during an idle minute");
  await tick(portal, 840000);
  assert.equal(counts["/api/catalog"], catalogs + 1, "the catalog refreshes after fifteen minutes");
  await portal.setViewportSize({ width: 390, height: 844 });
  await portal.screenshot({ path: path.join(output, "portal-mobile.png"), fullPage: true });
  assert.equal(await portal.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, "the portal must not overflow on mobile");
  assert.deepEqual(errors, []);
  const result = { counts, shortVisitPolls: 0, scheduledRefreshMinutes: 15, catalogRefreshMinutes: 15, hiddenMinutesWithoutRequests: 20, checks: ["new request appears on priority signal", "new comment appears on priority signal", "cached drawer opening without GET", "own comment visible before delayed save", "compact confirmation without duplicate comment or GET", "failure rollback and retained retry text", "live refresh deferred during pending save", "ordinary edit waits for scheduled refresh", "scheduled refresh while live", "Realtime reconnect", "background subscription cleanup", "refresh and reconnect on return", "daily banner", "revoked access", "cached public catalog", "desktop/mobile rendering"] };
  await writeFile(path.join(output, "query-traffic-verification.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result));
  await context.close();
} catch (error) {
  console.error("Verification failure:", error);
  for (const context of browser?.contexts() ?? []) {
    for (const page of context.pages()) {
      console.error(await page.locator("body").innerText().catch(() => "No rendered body"));
      await page.screenshot({ path: path.join(output, "query-traffic-failure.png"), fullPage: true }).catch(() => {});
    }
  }
  throw error;
} finally {
  await browser?.close();
  for (const process of processes) process.kill("SIGTERM");
  await isolated?.stop();
}
