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
    env: { ...process.env, VITE_API_URL: isolated.url, VITE_NEON_AUTH_URL: "", VITE_NEON_REALTIME_URL: "wss://egress-test.invalid/realtime", VITE_PORTAL_URL: portalUrl, VITE_WORKSPACE_URL: workspaceUrl },
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

const realtimeMock = `
import React from '/node_modules/.vite/deps/react.js';
const { useSyncExternalStore } = React;
export function RealtimeProvider({ children }) { return children; }
const subscribe = callback => { window.addEventListener('moc-live', callback); return () => window.removeEventListener('moc-live', callback); };
const snapshot = () => window.__mocLive;
export function useLiveQuery() {
  React.useEffect(() => {
    window.__mocLiveSubscriptions = (window.__mocLiveSubscriptions || 0) + 1;
    return () => { window.__mocLiveSubscriptions -= 1; };
  }, []);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
`;

async function tick(page, milliseconds) {
  // Let real HTTP requests settle between virtual timer ticks.
  for (let elapsed = 0; elapsed < milliseconds; elapsed += 15000) {
    await page.clock.runFor(Math.min(15000, milliseconds - elapsed));
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
  });
  await context.route("**/node_modules/.vite/deps/@neon_realtime-react.js*", (route) => route.fulfill({ contentType: "text/javascript", body: realtimeMock }));
  await context.route(`${isolated.url}/api/workspace/live`, (route) => route.fulfill({ json: { capability: "test-capability" } }));
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
  const revisionResponse = page.waitForResponse((response) => response.url() === `${isolated.url}/api/workspace`);
  await page.evaluate(() => { window.__mocLive = { status: "live", data: [{ id: "moc", revision: "2" }] }; window.dispatchEvent(new Event("moc-live")); });
  await revisionResponse;
  await page.getByText("Grace Egress Check", { exact: true }).waitFor();
  await page.waitForLoadState("networkidle");
  assert.equal(counts["/api/workspace"], initial + 1, "a changed revision refreshes the workspace once");
  await page.screenshot({ path: path.join(output, "live-settings-desktop.png"), fullPage: true });

  await page.evaluate(() => { window.__mocLive = { status: "error", data: undefined }; window.dispatchEvent(new Event("moc-live")); });
  await page.getByText("Live updates paused. Refresh to reconnect.").waitFor({ state: "attached" });
  const beforeFallback = counts["/api/workspace"];
  await tick(page, 65000);
  assert.equal(counts["/api/workspace"], beforeFallback, "a short visit must not trigger fallback polling");
  await tick(page, 240000);
  assert.equal(counts["/api/workspace"], beforeFallback + 1, "multiple settings observers must share one fallback refresh per five minutes");
  const recoveryResponse = page.waitForResponse((response) => response.url() === `${isolated.url}/api/workspace`);
  await page.evaluate(() => { window.__mocLive = { status: "live", data: [{ id: "moc", revision: "3" }] }; window.dispatchEvent(new Event("moc-live")); });
  await recoveryResponse;
  await page.waitForLoadState("networkidle");
  const recovered = counts["/api/workspace"];
  await tick(page, 65000);
  assert.equal(counts["/api/workspace"], recovered, "fallback polling stops when Realtime reconnects");

  await page.evaluate(() => { window.__mocVisible = false; window.dispatchEvent(new Event("visibilitychange")); });
  await page.waitForFunction(() => window.__mocLiveSubscriptions === 0);
  const beforeBackground = { ...counts };
  await tick(page, 20 * 60000);
  assert.deepEqual(counts, beforeBackground, "hidden tabs must not poll or renew live subscriptions");
  const returnResponse = page.waitForResponse((response) => response.url() === `${isolated.url}/api/workspace`);
  const returnCapability = page.waitForResponse((response) => response.url() === `${isolated.url}/api/workspace/live`);
  await page.evaluate(() => { window.__mocVisible = true; window.dispatchEvent(new Event("visibilitychange")); });
  await Promise.all([returnResponse, returnCapability]);
  await page.waitForFunction(() => window.__mocLiveSubscriptions === 1);
  await page.waitForLoadState("networkidle");
  await page.getByText("Grace Egress Check", { exact: true }).waitFor();

  await page.clock.setSystemTime(new Date("2026-10-29T23:59:58+02:00"));
  const boundaryResponse = page.waitForResponse((response) => response.url() === `${isolated.url}/api/workspace`);
  await page.evaluate(() => { window.__mocLive = { status: "live", data: [{ id: "moc", revision: "4" }] }; window.dispatchEvent(new Event("moc-live")); });
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
  const result = { counts, healthyIdlePolls: 0, fallbackRefreshMinutes: 5, catalogRefreshMinutes: 15, hiddenMinutesWithoutRequests: 20, checks: ["revision refresh", "Realtime fallback/recovery", "background subscription cleanup", "refresh and reconnect on return", "daily banner", "revoked access", "cached public catalog", "desktop/mobile rendering"] };
  await writeFile(path.join(output, "query-traffic-verification.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result));
  await context.close();
} catch (error) {
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
