#!/usr/bin/env node
/**
 * Focused rendered-state coverage for docs/UI-REVIEW.md.
 * Every API call is proxied to a disposable JSON API. This script never
 * continues browser API requests to API_URL (normally localhost:3001).
 *
 * Usage, with workspace and portal dev servers running:
 *   node scripts/check-ui-state-coverage.mjs
 *   node scripts/check-ui-state-coverage.mjs --only=errors
 *   node scripts/check-ui-state-coverage.mjs --only=mutations
 *   node scripts/check-ui-state-coverage.mjs --only=lifecycle,access,keyboard
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { startUiTestApi } from "./ui-test-server.mjs";

const W = process.env.WORKSPACE_URL || "http://localhost:5173";
const P = process.env.PORTAL_URL || "http://localhost:5174";
const API = process.env.API_URL || "http://localhost:3001";
const OUT = path.resolve(process.env.UI_COVERAGE_OUT || "output/reviews/state-coverage");
const INVENTORY_OUT = path.resolve(process.env.UI_INVENTORY_OUT || "output/reviews/round1/inventory/STATE-COVERAGE.json");
const only = process.argv.find((x) => x.startsWith("--only="))?.slice(7);
const V = {
  desktop: { width: 1440, height: 960 },
  tablet: { width: 834, height: 1112 },
  phone: { width: 390, height: 844 },
  narrow: { width: 320, height: 780 },
};
const result = {
  generatedAt: new Date().toISOString(),
  scope: "Finite representative reachable branch coverage; independent states and mutations are checked without generating a Cartesian product.",
  selection: only || "all-groups",
  isolatedApi: true,
  states: [],
  failures: [],
  incomplete: [],
};
const plannedStates = [
  ...["dashboard", "departments", "departments-sound", "requests", "calendar", "reports", "settings"].map((route) => ["workspace.cold503." + route, "errors"]),
  ["workspace.warm503.retry", "errors"],
  ["permissions.sound-route-gates", "access"],
  ["permissions.unapproved-session", "access"],
  ...["empty.dashboard", "empty.departments", "empty.requests", "empty.calendar", "empty.reports", "empty.settings-leader-list"].map((id) => [id, "empty"]),
  ["mutation.portal-create.busy-error-recovery", "mutations"],
  ...[
    "mutation.notifications.read.busy-error-recovery",
    "mutation.task.create.busy-error-recovery",
    "mutation.task.status.busy-error-recovery",
    "mutation.comments.post.busy-error-recovery",
    "mutation.request.approve.busy-error-recovery",
    "mutation.request.reject.busy-error-recovery",
  ].map((id) => [id, "mutations"]),
  ["mutation.portal-edit.busy-error-recovery", "mutations"],
  { stateId: "catalog.department-groups-ministry-service-remap-approve", group: "catalog", planned: true },
  { stateId: "departments.rename-group-create-delete-color", group: "departments", planned: true },
  { stateId: "tables.phone-members-departments-scrollcue-and-sidebar", group: "responsive", planned: true },
  { stateId: "members.invite-edit-duty-groups-leadership", group: "members", planned: true },
  ["portal.aired-date.validation-and-multiple", "portal"],
  ["empty.notifications-actions", "empty"],
  ["portal.tracking.pending-and-clipboard-denied", "portal"],
  ["portal.tracking.approved-in-progress-complete-rejected", "portal"],
  ["data.dense-long-dashboard-reports", "dense"],
  ["lifecycle.rejected-request-can-be-approved", "lifecycle"],
  ["lifecycle.report-milestones-and-widgets", "lifecycle"],
  ["keyboard.portal-first-invalid-and-described-error", "keyboard"],
  ["keyboard.mobile-drawer-trap-restore", "keyboard"],
  ["keyboard.task-detail-trap-restore-and-comment-draft", "keyboard"],
  ["keyboard.request-detail-trap-restore-and-comment-draft", "keyboard"],
  ["keyboard.request-and-task-filter-drawers", "keyboard"],
].flatMap((entry) => Array.isArray(entry)
  ? [{ stateId: entry[0], group: entry[1] }]
  : [entry]);
let browser;

function addState(id, group, viewport) {
  const row = { stateId: id, group, viewport, status: "running", assertions: [], screenshots: [], error: null };
  result.states.push(row);
  return row;
}
function expect(row, id, actual, predicate) {
  const passed = predicate(actual);
  row.assertions.push({ id: row.stateId + "." + id, passed, actual });
  assert.ok(passed, row.stateId + ": " + id + "; got " + JSON.stringify(actual));
}
function enabled(group) {
  return !only || only.split(",").some((selection) => group.includes(selection.trim()));
}
async function shot(page, row, suffix) {
  const filename = path.join(OUT, row.group, row.stateId + (suffix ? "-" + suffix : "") + ".png");
  await mkdir(path.dirname(filename), { recursive: true });
  await page.screenshot({ path: filename, fullPage: true, animations: "disabled" });
  row.screenshots.push(path.relative(OUT, filename));
}
async function isolated(viewport, origins) {
  let api;
  let startError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      api = await startUiTestApi(origins || [new URL(W).origin, new URL(P).origin]);
      break;
    } catch (error) {
      startError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  if (!api) throw startError ?? new Error("Isolated API startup failed without diagnostics.");
  const context = await browser.newContext({
    viewport: V[viewport] || viewport || V.desktop,
    timezoneId: "Africa/Johannesburg",
    hasTouch: (V[viewport]?.width || viewport?.width || 1440) <= 390,
    reducedMotion: "reduce",
  });
  const faults = new Map();
  const injected = [];
  await context.route(API + "/api/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const key = req.method() + " " + url.pathname;
    const fault = faults.get(key);
    if (fault && fault.remaining > 0) {
      fault.remaining -= 1;
      if (fault.delay) await new Promise((resolve) => setTimeout(resolve, fault.delay));
      injected.push({ key, status: fault.status, remaining: fault.remaining });
      await route.fulfill({
        status: fault.status,
        contentType: "application/json",
        body: JSON.stringify({ error: fault.message || "Isolated state fixture failure." }),
      });
      return;
    }
    try {
      const response = await route.fetch({ url: api.url + url.pathname + url.search });
      await route.fulfill({ response });
    } catch (error) {
      // A failed fixture API is terminal here; never fall through to the live API.
      injected.push({ key, status: 502, proxyError: String(error) });
      await route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "Isolated fixture API unavailable." }) });
    }
  });
  return { api, context, faults, injected };
}
async function dispose(f) {
  await f.context.close();
  await f.api.stop();
}
async function pageCase(id, group, viewport, body) {
  if (!enabled(group)) return;
  const row = addState(id, group, viewport);
  let fixture;
  let page;
  try {
    fixture = await isolated(viewport);
    page = await fixture.context.newPage();
    await body({ row, fixture, page });
    row.apiInjected = fixture.injected;
    row.status = "pass";
  } catch (error) {
    row.status = "fail";
    row.apiInjected = fixture?.injected ?? [];
    row.error = (error instanceof Error ? error.message : String(error))
      + (page ? "\nCurrent URL: " + page.url() : "");
    result.failures.push(id);
    if (page) {
      try {
        await shot(page, row, "failure-evidence");
      } catch {
        // Keep the original assertion/interaction failure as the case result.
      }
    }
  } finally {
    if (fixture) await dispose(fixture);
  }
  console.log(row.status.toUpperCase() + " " + id);
  if (row.error) console.error(row.error);
}
async function ready(page) {
  await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(250);
}
function requestTrigger(page, title) {
  return page.getByRole("button", { name: `Open ${title}`, exact: true });
}
async function loginRole(page, department) {
  await page.goto(W, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  if (department && department !== "cell-0") {
    const response = await page.evaluate(async (api) => {
      return fetch(api + "/api/auth/demo", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ department: "sound" }),
      }).then((r) => r.status);
    }, API);
    assert.equal(response, 200, "isolated demo role must be selected");
  }
}
async function patchWorkspace(context, apiUrl, change) {
  await context.route(API + "/api/workspace", async (route) => {
    const response = await route.fetch({ url: apiUrl + "/api/workspace" });
    const data = await response.json();
    change(data);
    await route.fulfill({ response, json: data });
  });
}
async function emptyWorkspace(data) {
  data.tasks = [];
  data.requests = [];
  data.activities = [];
  data.notifications = [];
  data.users = [];
}
async function noOverflow(row, page) {
  const sizes = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(row, "no-document-horizontal-overflow", sizes, (s) => s.document <= s.viewport + 1 && s.body <= s.viewport + 1);
}
async function settledFocusCycle(page, count = 24) {
  await page.waitForTimeout(300); // Let the popup's focus primitive finish opening.
  const samples = {
    afterPopupSettled300ms: await page.evaluate(() => Boolean(document.querySelector('[role="dialog"]')?.contains(document.activeElement))),
    after60ms: [],
    after300ms: [],
  };
  for (let i = 0; i < count; i += 1) {
    await page.keyboard.press("Tab");
    await page.waitForTimeout(60);
    samples.after60ms.push(await page.evaluate(() => Boolean(document.querySelector('[role="dialog"]')?.contains(document.activeElement))));
    await page.waitForTimeout(240);
    samples.after300ms.push(await page.evaluate(() => Boolean(document.querySelector('[role="dialog"]')?.contains(document.activeElement))));
  }
  return samples;
}
async function settledFocusRestore(page, expectedSelector) {
  await page.waitForTimeout(60);
  const check = () => typeof expectedSelector === "string"
    ? page.evaluate((selector) => Boolean(document.activeElement?.matches(selector)), expectedSelector)
    : expectedSelector.evaluate((node) => document.activeElement === node);
  const after60ms = await check();
  await page.waitForTimeout(240);
  const after300ms = await check();
  return { after60ms, after300ms };
}

async function errors() {
  const routes = ["/", "/departments", "/departments/sound", "/requests", "/calendar", "/reports", "/settings"];
  for (const routePath of routes) {
    const suffix = routePath === "/" ? "dashboard" : routePath.slice(1).replaceAll("/", "-");
    await pageCase("workspace.cold503." + suffix, "errors", "desktop", async ({ row, fixture, page }) => {
      // Workspace queries retry once per refetch; cover both automatic attempts
      // on the initial read and both attempts on the first manual retry.
      fixture.faults.set("GET /api/workspace", { status: 503, remaining: 4, message: "coverage cold workspace outage" });
      await page.goto(W + routePath, { waitUntil: "domcontentloaded" });
      const alert = page.getByRole("alert").first();
      await alert.waitFor({ timeout: 25000 });
      expect(row, "error-visible", await alert.innerText(), (x) => x.includes("coverage cold workspace outage"));
      await shot(page, row, "error");
      const retry = page.locator(".connection-error").getByRole("button", { name: "Retry", exact: true });
      expect(row, "retry-visible", await retry.isVisible(), Boolean);
      await retry.click();
      await alert.waitFor({ timeout: 12000 });
      expect(row, "repeated-failure-still-recoverable", await alert.isVisible(), Boolean);
      await shot(page, row, "retry-failed");
      await retry.click();
      await page.locator(".workspace-load-error").waitFor({ state: "detached", timeout: 15000 });
      await page.waitForFunction(() => !document.querySelector(".loading-card"));
      expect(row, "route-content-recovered", await page.locator(".workspace-load-error").count(), (n) => n === 0);
      expect(row, "recovery-alert-cleared", await page.getByRole("alert").count(), (n) => n === 0);
      await shot(page, row, "recovered");
      expect(row, "isolated-fault-injected", fixture.injected.length, (n) => n >= 2);
    });
  }
  await pageCase("workspace.warm503.retry", "errors", "phone", async ({ row, fixture, page }) => {
    await page.goto(W, { waitUntil: "domcontentloaded" });
    await ready(page);
    fixture.faults.set("GET /api/workspace", { status: 503, remaining: 2, message: "coverage warm connection lost" });
    await page.waitForTimeout(16000);
    const alert = page.getByRole("alert").first();
    await alert.waitFor({ timeout: 10000 });
    expect(row, "warm-error-visible", await alert.innerText(), (x) => x.includes("warm connection lost"));
    await shot(page, row, "warm-error");
    await page.getByRole("button", { name: /retry/i }).first().click();
    await page.waitForFunction(() => !document.querySelector(".loading-card"));
    expect(row, "warm-error-recovered", await page.locator(".loading-card").count(), (n) => n === 0);
    await shot(page, row, "recovered");
  });
}

async function accessAndEmpty() {
  await pageCase("permissions.sound-route-gates", "access", "desktop", async ({ row, page }) => {
    await loginRole(page, "sound");
    for (const routePath of ["/requests", "/reports", "/settings"]) {
      await page.goto(W + routePath, { waitUntil: "domcontentloaded" });
      await page.getByText(/managed by Cell 0|private to Cell 0|Your account/i).first().waitFor({ timeout: 10000 });
      expect(row, "gate-" + routePath, await page.locator("body").innerText(), (x) => /managed by Cell 0|private to Cell 0|Your account/i.test(x));
    }
    const privateState = await page.evaluate(async (api) => fetch(api + "/api/workspace").then((response) => response.json()), API);
    expect(row, "non-cell0-api-omits-request-inbox", privateState.requests, (requests) => Array.isArray(requests) && requests.length === 0);
    expect(row, "request-nav-hidden-for-other-departments", await page.getByRole("link", { name: "Requests", exact: true }).count(), (count) => count === 0);
    await page.goto(W + "/departments/cell-0", { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "This department is private" }).waitFor();
    await shot(page, row, "private");
    await page.goto(W + "/departments/sound", { waitUntil: "domcontentloaded" });
    await ready(page);
    expect(row, "own-team-visible", await page.locator(".page-content h1").innerText(), (x) => x === "Sound");
  });
  await pageCase("permissions.unapproved-session", "access", "desktop", async ({ row, fixture, page }) => {
    const fake = { user: { id: "unapproved", name: "Pending Leader", email: "pending@example.org", department: "sound", rank: "TJN", approved: false }, demo: false };
    await fixture.context.route(API + "/api/session", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fake) }));
    let workspaceRequests = 0;
    await fixture.context.route(API + "/api/workspace", async (route) => {
      workspaceRequests += 1;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ tasks: [], requests: [], users: [], activities: [], notifications: [] }) });
    });
    for (const routePath of ["/", "/departments/sound", "/settings", "/requests", "/reports", "/calendar"]) {
      await page.goto(W + routePath, { waitUntil: "domcontentloaded" });
      await page.getByRole("heading", { name: "Workspace access required" }).waitFor({ timeout: 10000 });
      expect(row, "global-unapproved-gate-" + routePath, await page.getByRole("heading", { name: "Workspace access required" }).count(), (n) => n === 1);
      expect(row, "check-access-available-" + routePath, await page.getByRole("button", { name: "Check access" }).isVisible(), Boolean);
      expect(row, "sign-out-available-" + routePath, await page.getByRole("button", { name: "Sign out" }).isVisible(), Boolean);
    }
    expect(row, "workspace-fetch-blocked", workspaceRequests, (n) => n === 0);
    await shot(page, row, "gate");
  });
  const emptyRoutes = [
    ["/", "empty.dashboard", /No active tasks\./i],
    ["/departments", "empty.departments", /No tasks here yet/i],
    ["/requests", "empty.requests", /There are no backlog requests in the inbox right now\./i],
    ["/calendar", "empty.calendar", null],
    ["/reports", "empty.reports", /No task activity/i],
  ];
  for (const [routePath, id, pattern] of emptyRoutes) {
    await pageCase(id, "empty", "desktop", async ({ row, fixture, page }) => {
      await patchWorkspace(fixture.context, fixture.api.url, emptyWorkspace);
      await page.goto(W + routePath, { waitUntil: "domcontentloaded" });
      await ready(page);
      if (pattern) {
        expect(row, "true-empty-state", await page.locator("body").innerText(), (x) => pattern.test(x));
      } else {
        expect(row, "no-calendar-events", await page.locator(".schedule-event").count(), (n) => n === 0);
        expect(row, "calendar-controls-rendered", await page.getByRole("button", { name: "Today" }).count(), (n) => n === 1);
      }
      await shot(page, row);
    });
  }
  await pageCase("empty.settings-leader-list", "empty", "desktop", async ({ row, fixture, page }) => {
    await patchWorkspace(fixture.context, fixture.api.url, (data) => { data.users = []; });
    await page.goto(W, { waitUntil: "domcontentloaded" });
    await ready(page);
    await page.goto(W + "/settings", { waitUntil: "domcontentloaded" });
    await ready(page);
    expect(row, "no-leader-rows", await page.locator(".leader-table tbody tr").count(), (n) => n === 0);
    await shot(page, row);
  });
  await pageCase("empty.notifications-actions", "empty", "desktop", async ({ row, fixture, page }) => {
    await patchWorkspace(fixture.context, fixture.api.url, emptyWorkspace);
    await page.goto(W, { waitUntil: "domcontentloaded" });
    await ready(page);
    await page.getByRole("button", { name: /^Notifications/ }).first().click();
    const dialog = page.getByRole("dialog", { name: "Notifications" });
    await dialog.waitFor();
    expect(row, "empty-notification-copy", await dialog.innerText(), (text) => text.includes("You’re all caught up."));
    expect(row, "no-mark-read-action-when-there-is-nothing-to-read", await dialog.getByRole("button", { name: "Mark all as read", exact: true }).count(), (count) => count === 0);
    await shot(page, row);
  });
}

async function formBasics(page, title, aired, row, servicePattern, ministryName) {
  await page.goto(P, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /Make a request/i }).click();
  const selects = page.locator(".request-form select");
  await page.waitForFunction(() => (document.querySelectorAll(".request-form select")[0]?.options.length ?? 0) > 1);
  // Portal contract: Request type is first and Ministry is second. Resolve
  // by visible option names so catalog ordering changes do not select a
  // different service/ministry silently.
  const options = await selects.nth(0).locator("option").evaluateAll((nodes) => nodes.map((n) => ({ value: n.value, label: n.textContent || "" })));
  const service = servicePattern
    ? options.find((o) => Boolean(o.value) && servicePattern.test(o.label))
    : options.find((o) => Boolean(o.value) && (aired ? /previously aired/i.test(o.label) : !/previously aired/i.test(o.label)));
  if (!service) throw new Error("Missing service fixture for aired=" + aired);
  await selects.nth(0).selectOption(service.value);
  // Ministry is the second field and is populated for the chosen request type.
  await page.waitForFunction(() => (document.querySelectorAll(".request-form select")[1]?.options.length ?? 0) > 1);
  const ministryOptions = await selects.nth(1).locator("option").evaluateAll((nodes) => nodes.map((n) => ({ value: n.value, label: n.textContent || "" })));
  const ministry = ministryOptions.find((o) => Boolean(o.value) && (ministryName ? o.label.trim() === ministryName : true));
  if (!ministry) throw new Error("Missing ministry option: " + (ministryName || "any non-empty ministry"));
  await selects.nth(1).selectOption(ministry.value);
  await page.getByPlaceholder("e.g. Youth retreat recap video").fill(title);
  await page.getByPlaceholder("Describe what you need…").fill("Isolated coverage instructions.");
  await page.getByPlaceholder("Anything else we should know?").fill("No live API writes.");
  if (aired) {
    if (await page.locator(".aired-date-row input").count() === 0) await page.getByRole("button", { name: /Add exact date/i }).click();
    await page.locator(".aired-date-row input").first().fill(new Date(Date.now() - 86400000).toISOString().slice(0, 10));
  }
  const day = new Date(Date.now() + 7 * 86400000);
  const dateValue = day.getFullYear() + "-" + String(day.getMonth() + 1).padStart(2, "0") + "-" + String(day.getDate()).padStart(2, "0") + "T12:00";
  await page.locator('input[type="datetime-local"]').fill(dateValue);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("heading", { name: /Step 2: Review and confirm/i }).waitFor();
  const reviewText = await page.locator(".request-review").innerText();
  const preserved = reviewText.includes(title)
    && reviewText.includes("Isolated coverage instructions.")
    && reviewText.includes("No live API writes.");
  if (row) expect(row, "two-step-back-preserves-complete-draft", preserved, Boolean);
  await page.getByRole("button", { name: /Back/i }).last().click();
  await page.getByRole("heading", { name: /Step 1: Request details/i }).waitFor();
  const returnedDraft = await page.getByPlaceholder("e.g. Youth retreat recap video").inputValue() === title
    && await page.getByPlaceholder("Describe what you need…").inputValue() === "Isolated coverage instructions."
    && await page.getByPlaceholder("Anything else we should know?").inputValue() === "No live API writes."
    && Boolean(await page.locator('input[type="datetime-local"]').inputValue());
  if (row) expect(row, "back-keeps-complete-draft", returnedDraft, Boolean);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("heading", { name: /Step 2: Review and confirm/i }).waitFor();
}

async function navigateSettingsSection(page, section) {
  let navigation = page.getByRole("navigation", { name: "Settings", exact: true });
  if (!await navigation.isVisible()) {
    await page.getByRole("button", { name: "Open navigation", exact: true }).click();
    navigation = page.getByRole("navigation", { name: "Settings", exact: true });
  }
  await navigation.getByRole("link", { name: section, exact: true }).click();
  await page.getByRole("heading", { name: section, exact: true }).waitFor();
}

async function createDepartmentAndGroups(page, name, firstGroup, secondGroup) {
  await page.goto(W + "/settings", { waitUntil: "domcontentloaded" });
  await ready(page);
  await navigateSettingsSection(page, "Departments");
  await page.getByRole("heading", { name: "Departments" }).waitFor();
  await page.getByRole("button", { name: "New department", exact: true }).click();
  const createDialog = page.getByRole("dialog", { name: "New department" });
  await createDialog.waitFor();
  await createDialog.getByLabel("Department name", { exact: true }).fill(name);
  await createDialog.getByLabel("First group", { exact: true }).fill(firstGroup);
  await createDialog.getByRole("combobox", { name: "Edit New department calendar color", exact: true }).click();
  await page.getByRole("option", { name: "Blue", exact: true }).click();
  await createDialog.getByRole("button", { name: "Create department", exact: true }).click();
  await createDialog.waitFor({ state: "detached" });
  const groups = page.getByRole("combobox", { name: `Edit ${name} groups`, exact: true });
  await groups.click();
  await page.getByRole("combobox", { name: `Search ${name} groups`, exact: true }).fill(secondGroup);
  await page.getByRole("option", { name: "Create new group", exact: true }).click();
  await groups.getByText(secondGroup, { exact: true }).waitFor();
  await page.getByRole("combobox", { name: `Search ${name} groups`, exact: true }).press("Escape");
  const state = await page.evaluate(async (api) => {
    const response = await fetch(api + "/api/workspace");
    if (!response.ok) throw new Error("Isolated workspace read failed: " + response.status);
    return response.json();
  }, API);
  const department = state.catalog.departments.find((item) => item.name === name);
  if (!department) throw new Error("Created department missing from persisted catalog: " + name);
  return department;
}

async function mutations() {
  await pageCase("mutation.portal-create.busy-error-recovery", "mutations", "phone", async ({ row, fixture, page }) => {
    await formBasics(page, "coverage create mutation", false, row);
    fixture.faults.set("POST /api/requests", { status: 503, remaining: 1, delay: 700, message: "coverage create failed" });
    await page.getByRole("button", { name: "Send request", exact: true }).click();
    const busy = page.getByRole("button", { name: "Sending…" });
    await busy.waitFor();
    expect(row, "busy-disabled", await busy.isDisabled(), Boolean);
    await shot(page, row, "busy");
    await page.getByRole("alert").waitFor();
    expect(row, "normalized-error-visible", await page.getByRole("alert").innerText(), (x) => /temporarily unavailable|couldn't be sent|try again/i.test(x));
    expect(row, "isolated-create-failure-injected", fixture.injected.some((x) => x.key === "POST /api/requests"), Boolean);
    await shot(page, row, "error");
    await page.getByRole("button", { name: "Send request", exact: true }).click();
    await page.locator(".request-success").waitFor();
    expect(row, "retry-receipt", await page.locator(".access-code").innerText(), (x) => /^MOC-/.test(x.trim()));
    await shot(page, row, "recovered");
  });

  const specs = [
    ["notifications.read", "/", async (page) => { await page.getByRole("button", { name: /Notifications/i }).first().click(); await page.getByRole("button", { name: /Mark all as read/i }).click(); return { busy: page.getByRole("button", { name: /Mark all as read/i }), error: page.getByRole("alert"), retry: () => page.getByRole("button", { name: /Mark all as read/i }).click() }; }],
    ["task.create", "/departments/sound", async (page) => { await page.getByRole("button", { name: /New internal task/i }).click(); await page.getByPlaceholder("e.g. Prepare Sunday service graphics").fill("Coverage task"); const due = new Date(Date.now() + 7 * 86400000); await page.locator('.modal-panel input[type="datetime-local"]').fill(due.getFullYear() + "-" + String(due.getMonth() + 1).padStart(2, "0") + "-" + String(due.getDate()).padStart(2, "0") + "T12:00"); await page.getByPlaceholder("What needs to be delivered?").fill("Coverage instructions."); await page.getByPlaceholder("Context and coordination details").fill("Isolated fixture."); const submit = page.locator(".modal-panel button[type=submit]"); await submit.click(); return { busy: page.locator(".modal-panel button[type=submit]"), error: page.getByRole("alert"), retry: () => page.locator(".modal-panel button[type=submit]").click() }; }],
    ["task.status", "/departments/sound", async (page) => { await page.locator(".task-card-open").first().click(); await page.getByRole("button", { name: "Complete", exact: true }).click(); return { busy: page.getByRole("button", { name: "Complete", exact: true }), error: page.getByRole("alert"), retry: () => page.getByRole("button", { name: "Complete", exact: true }).click() }; }],
    ["comments.post", "/departments/sound", async (page) => { await page.locator(".task-card-open").first().click(); await page.getByRole("textbox", { name: "Add a comment" }).fill("Coverage comment retry."); await page.getByRole("button", { name: "Post comment" }).click(); return { busy: page.getByRole("button", { name: "Posting…" }), error: page.getByRole("alert"), retry: () => page.getByRole("button", { name: "Post comment" }).click() }; }],
    ["request.approve", "/requests", async (page) => { await page.getByRole("button", { name: /^Open / }).first().click(); await page.getByRole("button", { name: "Approve and route" }).click(); return { busy: page.getByRole("button", { name: "Routing…" }), error: page.getByRole("alert"), retry: () => page.getByRole("button", { name: "Approve and route" }).click() }; }],
    ["request.reject", "/requests", async (page) => { await page.getByRole("button", { name: /^Open / }).first().click(); await page.getByRole("button", { name: "Reject request" }).click(); await page.getByLabel("Reason for rejection").fill("Coverage rejection reason."); await page.getByRole("button", { name: "Reject request" }).click(); return { busy: page.getByRole("button", { name: "Rejecting…" }), error: page.getByRole("alert"), retry: () => page.getByRole("button", { name: "Reject request" }).click() }; }],
  ];
  for (const [id, routePath, action] of specs) {
    await pageCase("mutation." + id + ".busy-error-recovery", "mutations", "desktop", async ({ row, fixture, page }) => {
      await page.goto(W, { waitUntil: "domcontentloaded" });
      await ready(page);
      if (id.startsWith("request.")) {
        const portal = await fixture.context.newPage();
        await formBasics(portal, "coverage " + id, false, row);
        await portal.getByRole("button", { name: "Send request", exact: true }).click();
        await portal.locator(".request-success").waitFor();
      }
      await page.goto(W + routePath, { waitUntil: "domcontentloaded" });
      await ready(page);
      fixture.faults.set("POST /api/actions", { status: 503, remaining: 1, delay: 650, message: "coverage action failed" });
      const controls = await action(page);
      await controls.busy.waitFor({ timeout: 4000 });
      expect(row, "busy-disabled", await controls.busy.isDisabled(), Boolean);
      await shot(page, row, "busy");
      await controls.error.waitFor({ timeout: 10000 });
      expect(row, "failure-visible", await controls.error.innerText(), (x) => x.includes("coverage action failed"));
      await shot(page, row, "error");
      await controls.retry();
      await page.waitForTimeout(800);
      expect(row, "error-cleared-after-retry", await page.locator("body").innerText(), (x) => !x.includes("coverage action failed"));
      await shot(page, row, "recovered");
      expect(row, "fixture-api-failure-was-injected", fixture.injected.some((x) => x.key === "POST /api/actions"), Boolean);
    });
  }
  await pageCase("mutation.portal-edit.busy-error-recovery", "mutations", "desktop", async ({ row, fixture, page }) => {
    await formBasics(page, "coverage edit mutation", false, row);
    await page.getByRole("button", { name: "Send request", exact: true }).click();
    await page.locator(".request-success").waitFor();
    await page.getByRole("button", { name: /Track this request/i }).click();
    await page.locator(".tracking-summary").waitFor();
    const title = page.getByPlaceholder("e.g. Youth retreat recap video");
    await title.fill("coverage edit updated");
    fixture.faults.set("PATCH /api/requests", { status: 503, remaining: 1, delay: 650, message: "coverage edit failed" });
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    const busy = page.getByRole("button", { name: "Saving…" });
    await busy.waitFor();
    expect(row, "busy-disabled", await busy.isDisabled(), Boolean);
    await shot(page, row, "busy");
    await page.getByRole("alert").waitFor();
    expect(row, "error-keeps-draft", await title.inputValue(), (x) => x === "coverage edit updated");
    await shot(page, row, "error");
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await page.getByText("Changes saved.", { exact: true }).waitFor();
    expect(row, "retry-persists-title", await page.locator(".tracking-summary h3").innerText(), (x) => x === "coverage edit updated");
    await shot(page, row, "recovered");
  });
}

async function departmentManagementJourney() {
  await pageCase("departments.rename-group-create-delete-color", "departments", "desktop", async ({ row, fixture, page }) => {
    const initialName = "Coverage Inline Department";
    const first = "Inline Alpha";
    const second = "Inline Beta";
    const department = await createDepartmentAndGroups(page, initialName, first, second);
    let departmentRow = page.locator(".department-table tr").filter({ has: page.getByRole("combobox", { name: `Edit ${initialName} groups`, exact: true }) });
    const nameInput = page.getByRole("textbox", { name: `${initialName} department name`, exact: true });
    expect(row, "department-table-has-distinct-fields-without-actions-column", (await page.locator(".department-table thead th").allTextContents()).map((value) => value.trim()).filter(Boolean), (headers) => headers.join("|") === "Department|Groups|Color");
    expect(row, "department-table-has-shared-selection-column", await page.locator(".department-table thead").getByRole("checkbox").count(), (count) => count === 1);
    const groupBadges = await departmentRow.getByRole("combobox", { name: `Edit ${initialName} groups`, exact: true }).locator(".badge").evaluateAll((nodes) => nodes.map((node) => {
      const style = getComputedStyle(node);
      return { text: node.textContent?.trim(), color: style.color, background: style.backgroundColor };
    }));
    expect(row, "department-groups-show-full-named-color-badges", groupBadges, (items) => items.length === 2 && items.some((item) => item.text === first) && items.some((item) => item.text === second) && items.every((item) => item.color !== "rgba(0, 0, 0, 0)" && item.background !== "rgba(0, 0, 0, 0)"));
    await nameInput.fill("Cancelled department draft");
    await nameInput.press("Escape");
    expect(row, "department-name-escape-restores-baseline", await nameInput.innerText(), (text) => text === initialName);

    await nameInput.fill("Sound");
    await nameInput.press("Enter");
    const duplicateNameError = departmentRow.getByRole("alert");
    await duplicateNameError.waitFor();
    await page.waitForFunction((label) => document.activeElement?.getAttribute("aria-label") === label, `${initialName} department name`);
    expect(row, "department-name-duplicate-validation-retains-draft", { message: await duplicateNameError.innerText(), value: await nameInput.innerText(), focus: await nameInput.evaluate((node) => document.activeElement === node) }, (state) => /already exists/i.test(state.message) && state.value === "Sound" && state.focus);

    const nextName = "Coverage Inline Department Renamed";
    await nameInput.fill(nextName);
    fixture.faults.set("POST /api/actions", { status: 503, remaining: 1, delay: 650, message: "coverage department rename failed" });
    await nameInput.press("Enter");
    await nameInput.waitFor({ state: "visible" });
    await page.waitForFunction((label) => document.querySelector(`[aria-label="${CSS.escape(label)}"]`)?.getAttribute("aria-busy") === "true", `${initialName} department name`);
    await shot(page, row, "department-rename-busy");
    const renameError = departmentRow.getByRole("alert");
    await renameError.waitFor();
    await page.waitForTimeout(60);
    const focusDescription = () => nameInput.evaluate((node) => ({
      focused: document.activeElement === node,
      activeTag: document.activeElement?.tagName ?? null,
      activeId: document.activeElement?.id ?? null,
      activeLabel: document.activeElement?.getAttribute("aria-label") ?? null,
      activeText: document.activeElement?.textContent?.trim().slice(0, 40) ?? null,
    }));
    const renameErrorAt60ms = await focusDescription();
    await page.waitForTimeout(240);
    const renameErrorAt300ms = await focusDescription();
    expect(row, "department-name-error-retains-draft", { message: await renameError.innerText(), value: await nameInput.innerText(), focusAt60ms: renameErrorAt60ms, focusAt300ms: renameErrorAt300ms }, (state) => state.message.includes("coverage department rename failed") && state.value === nextName && state.focusAt300ms.focused);
    await shot(page, row, "department-rename-error-draft");
    await nameInput.press("Enter");
    await page.getByRole("textbox", { name: `${nextName} department name`, exact: true }).waitFor();
    departmentRow = page.locator(".department-table tr").filter({ has: page.getByRole("combobox", { name: `Edit ${nextName} groups`, exact: true }) });

    const groups = page.getByRole("combobox", { name: `Edit ${nextName} groups`, exact: true });
    await groups.click();
    const groupInput = page.getByRole("combobox", { name: `Search ${nextName} groups`, exact: true });
    const groupPopup = page.getByRole("listbox").last().locator("xpath=..");
    expect(row, "groups-use-combobox-without-drawer", await page.locator(".modal-panel[data-side]").count(), (count) => count === 0);
    await groupInput.fill(first);
    expect(row, "group-create-exact-duplicate-disabled", await page.getByRole("option", { name: "Create new group", exact: true }).getAttribute("aria-disabled"), (value) => value === "true");
    const third = "Inline Gamma";
    await groupInput.fill(third);
    fixture.faults.set("POST /api/actions", { status: 503, remaining: 1, delay: 650, message: "coverage group create failed" });
    await page.getByRole("option", { name: "Create new group", exact: true }).click();
    const groupSaveError = groupPopup.getByRole("alert");
    await groupSaveError.waitFor();
    expect(row, "group-create-error-retains-draft-for-retry", { message: await groupSaveError.innerText(), value: await groupInput.inputValue() }, (state) => state.message.includes("coverage group create failed") && state.value === third);
    await shot(page, row, "group-create-error-draft");
    await page.getByRole("option", { name: "Create new group", exact: true }).click();
    await groups.getByText(third, { exact: true }).waitFor();
    await page.getByRole("option", { name: third, exact: true }).click();
    const deleteDialog = page.getByRole("dialog", { name: "Delete group?" });
    expect(row, "group-delete-confirmation-names-target", await deleteDialog.innerText(), (text) => text.includes(third) && text.includes("must be reassigned first"));
    await deleteDialog.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(row, "group-delete-cancel-keeps-value", await groups.getByText(third, { exact: true }).count(), (count) => count === 1);
    await groups.click();
    await page.getByRole("option", { name: third, exact: true }).click();
    await deleteDialog.getByRole("button", { name: "Delete group", exact: true }).click();
    await deleteDialog.waitFor({ state: "detached" });
    await shot(page, row, "group-create-and-delete-recovered");

    const colorLabel = `Edit ${nextName} calendar color`;
    await departmentRow.getByRole("combobox", { name: colorLabel, exact: true }).click();
    const colorSearch = page.getByRole("combobox", { name: `Search ${nextName} calendar color`, exact: true });
    const colorOptions = page.getByRole("listbox").last();
    const colorPopup = colorOptions.locator("xpath=..");
    await colorSearch.fill("Indigo");
    const colorOption = colorOptions.getByRole("option", { name: "Indigo", exact: true });
    await colorOption.waitFor();
    fixture.faults.set("POST /api/actions", { status: 503, remaining: 1, delay: 650, message: "coverage department color failed" });
    await colorOption.click();
    const colorError = colorPopup.getByRole("alert");
    await colorError.waitFor();
    expect(row, "department-color-error-retains-draft", { message: await colorError.innerText(), value: await colorSearch.inputValue() }, (state) => state.message.includes("coverage department color failed") && state.value === "Indigo");
    await colorOption.click();
    await colorPopup.waitFor({ state: "detached" });
    await departmentRow.getByRole("combobox", { name: colorLabel, exact: true }).getByText(/indigo/i).waitFor();
    const persisted = await page.evaluate(async ({ api, id }) => {
      const response = await fetch(api + "/api/workspace");
      const state = await response.json();
      const item = state.catalog.departments.find((candidate) => candidate.id === id);
      return item && { name: item.name, groups: item.groups, color: item.color };
    }, { api: API, id: department.id });
    expect(row, "department-groups-and-color-persisted", persisted, (value) => value.name === nextName && value.groups.includes(first) && value.groups.includes(second) && !value.groups.includes(third) && value.color === "indigo");
    expect(row, "department-actions-failures-injected-through-disposable-api", fixture.injected.filter((item) => item.key === "POST /api/actions" && item.status === 503).length === 3, Boolean);
    await page.getByRole("checkbox", { name: `Select ${nextName}`, exact: true }).check();
    await page.getByRole("button", { name: "Delete departments", exact: true }).click();
    const departmentDelete = page.getByRole("dialog", { name: "Delete departments?", exact: true });
    await departmentDelete.waitFor();
    expect(row, "department-delete-confirmation-names-target", await departmentDelete.innerText(), (text) => text.includes(nextName));
    await departmentDelete.getByRole("button", { name: "Delete departments", exact: true }).click();
    await departmentDelete.waitFor({ state: "detached" });
    expect(row, "department-delete-removes-row", await page.getByRole("combobox", { name: `Edit ${nextName} groups`, exact: true }).count(), (count) => count === 0);
    await shot(page, row, "department-final");
  });

  await pageCase("tables.phone-members-departments-scrollcue-and-sidebar", "responsive", "narrow", async ({ row, page }) => {
    await page.goto(W + "/settings", { waitUntil: "domcontentloaded" });
    await ready(page);
    expect(row, "settings-segmented-control-removed", await page.getByRole("group", { name: "Settings section" }).count(), (count) => count === 0);
    await page.getByRole("button", { name: "Open navigation", exact: true }).click();
    const settingsNavigation = page.getByRole("navigation", { name: "Settings", exact: true });
    const settingsLinks = await settingsNavigation.getByRole("link").evaluateAll((items) => items.map((node) => { const rect = node.getBoundingClientRect(); return { label: node.textContent?.trim(), current: node.getAttribute("aria-current"), x: rect.x, width: rect.width, height: rect.height }; }));
    expect(row, "settings-mobile-menu-shares-section-links", settingsLinks, (items) => items.length === 2 && items[0].label === "Members" && items[0].current === "page" && items[1].label === "Departments" && items.every((item) => item.x >= 0 && item.width >= 36 && item.height >= 32 && item.x + item.width <= 320));
    await settingsNavigation.getByRole("link", { name: "Departments", exact: true }).click();
    await page.getByRole("button", { name: "Open navigation", exact: true }).click();
    expect(row, "settings-hash-selects-one-mobile-section", { active: await settingsNavigation.locator("a.active").count(), current: await settingsNavigation.locator('a[aria-current="page"]').allTextContents() }, (value) => value.active === 1 && value.current.length === 1 && value.current[0].trim() === "Departments");
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "detached" });
    const region = page.getByRole("region", { name: "Departments table. Scroll horizontally to see all columns." });
    await region.waitFor();
    const geometry = await region.evaluate((node) => ({
      clientWidth: node.clientWidth,
      scrollWidth: node.scrollWidth,
      overflowX: getComputedStyle(node).overflowX,
      focusable: node.tabIndex >= 0,
      tableWidth: node.querySelector("table")?.getBoundingClientRect().width ?? 0,
      cueVisible: Boolean(document.body.innerText.includes("Scroll horizontally to see all columns")),
    }));
    expect(row, "phone-department-table-keeps-horizontal-scroll-region", geometry, (value) => value.clientWidth > 0 && value.scrollWidth > value.clientWidth && value.focusable && value.tableWidth >= value.scrollWidth - 2);
    expect(row, "phone-department-scroll-cue-visible", geometry.cueVisible, Boolean);
    await navigateSettingsSection(page, "Members");
    const memberRegion = page.getByRole("region", { name: "Members table; scroll horizontally to see all columns" });
    await memberRegion.waitFor();
    const memberGeometry = await memberRegion.evaluate((node) => ({ clientWidth: node.clientWidth, scrollWidth: node.scrollWidth, tableWidth: node.querySelector("table")?.getBoundingClientRect().width ?? 0, focusable: node.tabIndex >= 0, cue: document.body.innerText.includes("Scroll horizontally to see all member fields") }));
    expect(row, "phone-members-table-scroll-cue-and-region", memberGeometry, (value) => value.clientWidth > 0 && value.scrollWidth > value.clientWidth && value.tableWidth >= value.scrollWidth - 2 && value.focusable && value.cue);
    await memberRegion.focus();
    const keyboardAccessible = await memberRegion.evaluate((node) => ({ focused: document.activeElement === node, tabIndex: node.tabIndex, scrollLeft: node.scrollLeft }));
    expect(row, "table-region-keyboard-focusable-scroll-cue-target", keyboardAccessible, (value) => value.focused && value.tabIndex >= 0 && Number.isFinite(value.scrollLeft));
    await page.getByRole("button", { name: "Open navigation" }).click();
    const mobileNav = page.locator('nav[aria-label="All workspace pages"] .nav-item');
    await mobileNav.first().waitFor();
    const nav = await mobileNav.evaluateAll((items) => items.map((node) => { const r = node.getBoundingClientRect(); return { label: node.textContent?.trim(), x: r.x, y: r.y, width: r.width, height: r.height }; }));
    expect(row, "mobile-navigation-links-have-usable-width-and-touch-targets", nav, (items) => items.length >= 4 && items.every((item) => item.x >= 0 && item.width >= 32 && item.height >= 32 && item.x + item.width <= 320));
    const reached = [];
    for (const link of await mobileNav.all()) {
      await link.scrollIntoViewIfNeeded();
      reached.push(await link.evaluate((node) => { const rect = node.getBoundingClientRect(); return { label: node.textContent?.trim(), top: rect.top, bottom: rect.bottom, viewportHeight: innerHeight }; }));
    }
    expect(row, "mobile-navigation-long-menu-keeps-every-link-reachable", reached, (items) => items.every((item) => item.top >= 0 && item.bottom <= item.viewportHeight));
    await page.keyboard.press("Escape");
    const navRestore = await settledFocusRestore(page, 'button[aria-label="Open navigation"]');
    expect(row, "mobile-navigation-focus-restored-after-settled-close", navRestore, (value) => value.after60ms && value.after300ms);
    await shot(page, row, "phone-table-and-navigation");
  });
}

async function catalogRoutingJourney() {
  await pageCase("catalog.department-groups-ministry-service-remap-approve", "catalog", "desktop", async ({ row, fixture, page }) => {
    let ministryName = "Coverage Ministry";
    let serviceName = "Coverage Request Service";
    const requestTitle = "Coverage routed after service remap";
    const departmentName = "Coverage Routing";
    const firstGroup = "Studio Alpha";
    const secondGroup = "Studio Beta";
    const department = await createDepartmentAndGroups(page, departmentName, firstGroup, secondGroup);
    expect(row, "department-and-groups-persisted", department, (item) => item.groups.includes(firstGroup) && item.groups.includes(secondGroup));
    await shot(page, row, "department-created");

    await page.goto(W + "/settings#public-request", { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Public request", exact: true }).waitFor();
    const catalogDialog = page.locator("section#public-request");
    await shot(page, row, "catalog-settings-open");
    await catalogDialog.getByRole("button", { name: "Ministries", exact: true }).click();
    await catalogDialog.getByRole("button", { name: "New ministry", exact: true }).click();
    const ministryDialog = page.getByRole("dialog", { name: "New ministry", exact: true });
    await ministryDialog.getByLabel("New ministry name", { exact: true }).fill(ministryName);
    await ministryDialog.getByRole("button", { name: "Create ministry", exact: true }).click();
    await ministryDialog.waitFor({ state: "detached" });
    await catalogDialog.getByText(ministryName, { exact: true }).waitFor();
    await shot(page, row, "catalog-ministry-created");
    const ministryEditor = catalogDialog.getByRole("textbox", { name: `${ministryName} ministry name`, exact: true });
    await ministryEditor.waitFor();
    await ministryEditor.fill("Discarded ministry draft");
    await ministryEditor.press("Escape");
    expect(row, "escape-cancels-ministry-cell-without-closing-parent", await catalogDialog.isVisible(), Boolean);
    await ministryEditor.fill(ministryName);
    const renamedMinistry = `${ministryName} Updated`;
    await ministryEditor.fill(renamedMinistry);
    await ministryEditor.press("Enter");
    await catalogDialog.getByRole("textbox", { name: `${renamedMinistry} ministry name`, exact: true }).waitFor();
    ministryName = renamedMinistry;
    await catalogDialog.getByRole("button", { name: "Request types", exact: true }).click();
    await catalogDialog.getByRole("button", { name: "New request type", exact: true }).click();
    const serviceDialog = page.getByRole("dialog", { name: "New request type", exact: true });
    await serviceDialog.getByLabel("New request type name", { exact: true }).fill(serviceName);
    await serviceDialog.getByLabel("New request type department", { exact: true }).selectOption(department.id);
    await serviceDialog.getByLabel("New request type group", { exact: true }).selectOption({ label: firstGroup });
    await serviceDialog.getByRole("button", { name: "Create request type", exact: true }).click();
    await serviceDialog.waitFor({ state: "detached" });
    await catalogDialog.getByText(serviceName, { exact: true }).waitFor();
    const otherServiceDepartment = await page.evaluate(async ({ api, currentId }) => {
      const response = await fetch(api + "/api/workspace");
      if (!response.ok) throw new Error("Isolated workspace read failed: " + response.status);
      const state = await response.json();
      return state.catalog.departments.find((item) => item.id !== currentId && item.groups?.length) ?? null;
    }, { api: API, currentId: department.id });
    if (!otherServiceDepartment) throw new Error("A second department with groups is required for service department remapping");
    const serviceDepartmentLabel = `Edit ${serviceName} department`;
    await catalogDialog.getByRole("combobox", { name: serviceDepartmentLabel, exact: true }).click();
    const serviceDepartmentSearch = page.getByRole("combobox", { name: `Search ${serviceName} department`, exact: true });
    await serviceDepartmentSearch.fill(otherServiceDepartment.name);
    const otherDepartmentOption = page.getByRole("option", { name: new RegExp(`^${otherServiceDepartment.name}\\b`) });
    await otherDepartmentOption.waitFor();
    expect(row, "service-department-option-is-compact", await otherDepartmentOption.innerText(), (text) => text.trim() === otherServiceDepartment.name && !/Group:/i.test(text));
    await otherDepartmentOption.click();
    await catalogDialog.getByRole("combobox", { name: serviceDepartmentLabel, exact: true }).getByText(otherServiceDepartment.name, { exact: true }).waitFor();
    await catalogDialog.getByRole("combobox", { name: serviceDepartmentLabel, exact: true }).click();
    await page.getByRole("combobox", { name: `Search ${serviceName} department`, exact: true }).fill(departmentName);
    await page.getByRole("option", { name: new RegExp(`^${departmentName}\\b`) }).click();
    await catalogDialog.getByRole("combobox", { name: serviceDepartmentLabel, exact: true }).getByText(departmentName, { exact: true }).waitFor();
    const serviceNameEditor = catalogDialog.getByRole("textbox", { name: `${serviceName} request type name`, exact: true });
    await serviceNameEditor.waitFor();
    await serviceNameEditor.fill("Discarded service draft");
    await serviceNameEditor.press("Escape");
    await serviceNameEditor.fill(serviceName);
    const renamedService = `${serviceName} Updated`;
    await serviceNameEditor.fill(renamedService);
    await serviceNameEditor.press("Enter");
    await catalogDialog.getByRole("textbox", { name: `${renamedService} request type name`, exact: true }).waitFor();
    serviceName = renamedService;
    const airedRequirementLabel = `Edit ${serviceName} aired-date requirement`;
    await catalogDialog.getByRole("combobox", { name: airedRequirementLabel, exact: true }).click();
    const airedSearch = page.getByRole("combobox", { name: `Search ${serviceName} aired-date requirement`, exact: true });
    await airedSearch.waitFor();
    expect(row, "aired-date-requirement-offers-both-values", await page.getByRole("option").allTextContents(), (values) => values.includes("Required") && values.includes("Not required"));
    await page.getByRole("option", { name: "Required", exact: true }).click();
    await catalogDialog.getByRole("combobox", { name: airedRequirementLabel, exact: true }).waitFor();
    const serviceGroupLabel = `Edit ${serviceName} group`;
    await catalogDialog.getByRole("combobox", { name: serviceGroupLabel, exact: true }).click();
    const serviceGroup = page.getByRole("combobox", { name: `Search ${serviceName} group`, exact: true });
    await serviceGroup.waitFor();
    await serviceGroup.fill(secondGroup);
    await page.getByRole("option", { name: secondGroup, exact: true }).click();
    await serviceGroup.waitFor({ state: "detached" });
    expect(row, "catalog-created-in-visible-list", await catalogDialog.innerText(), (text) => text.includes(ministryName) || text.includes(serviceName));
    await shot(page, row, "catalog-created");

    await page.goto(W + "/settings#departments", { waitUntil: "domcontentloaded" });
    await ready(page);
    const groups = page.getByRole("combobox", { name: `Edit ${department.name} groups`, exact: true });
    await groups.click();
    await page.getByRole("option", { name: secondGroup, exact: true }).click();
    const blockedDelete = page.getByRole("dialog", { name: "Delete group?" });
    expect(row, "in-use-group-delete-confirmation-explains-reassignment", await blockedDelete.innerText(), (text) => text.includes(secondGroup) && /reassigned first/i.test(text));
    await blockedDelete.getByRole("button", { name: "Delete group", exact: true }).click();
    const blockedError = blockedDelete.getByRole("alert");
    await blockedError.waitFor();
    expect(row, "in-use-group-delete-rejected", await blockedError.innerText(), (text) => /Reassign members, services, and tasks/.test(text));
    await shot(page, row, "in-use-group-delete-blocked");
    await blockedDelete.getByRole("button", { name: "Cancel", exact: true }).click();
    await blockedDelete.waitFor({ state: "detached" });
    expect(row, "in-use-group-retained-after-rejected-delete", await groups.getByText(secondGroup, { exact: true }).count(), (count) => count === 1);

    const portal = await fixture.context.newPage();
    await formBasics(portal, requestTitle, true, row, new RegExp("^" + serviceName + "$"), ministryName);
    await shot(portal, row, "public-request-review");
    await portal.getByRole("button", { name: "Send request", exact: true }).click();
    await portal.locator(".request-success").waitFor();
    expect(row, "public-request-receipt", await portal.locator(".request-success").innerText(), (text) => text.includes("We’ve got it.") && text.includes("Your access code"));
    const privateAccessCode = (await portal.locator(".access-code").innerText()).trim();
    expect(row, "private-access-code-format", privateAccessCode, (value) => /^MOC-/.test(value));
    const submitted = await portal.evaluate(async (api) => {
      const response = await fetch(api + "/api/workspace");
      if (!response.ok) throw new Error("Isolated workspace read failed: " + response.status);
      return response.json();
    }, API);
    const createdRequest = submitted.requests.find((request) => request.title === requestTitle);
    const createdService = submitted.catalog.services.find((item) => item.name === serviceName);
    expect(row, "request-saved-through-isolated-api", createdRequest && { ministry: createdRequest.ministry, service: createdRequest.service, configuredServiceId: createdService?.id }, (saved) => saved.ministry === ministryName && saved.service === createdService?.id);

    await page.goto(W + "/requests", { waitUntil: "domcontentloaded" });
    await ready(page);
    const requestTable = page.locator(".requests-data-table");
    const requestHeaders = (await requestTable.locator("thead th").allTextContents()).map((value) => value.trim());
    expect(row, "request-table-uses-distinct-named-columns", requestHeaders, (headers) => headers.join("|") === "Task|Ministry|Service|Due date|Group|Department|Status");
    const requestOpen = requestTrigger(page, requestTitle);
    const requestRow = requestTable.locator("tbody tr").filter({ has: requestOpen });
    await requestRow.waitFor();
    expect(row, "request-table-omits-reference-and-private-code", { headers: requestHeaders, rowText: await requestRow.innerText() }, (value) => !value.headers.includes("Reference") && !value.rowText.includes(createdRequest.reference) && !value.rowText.includes(privateAccessCode));
    expect(row, "request-row-title-is-an-explicit-open-control", await requestOpen.getAttribute("aria-label"), (label) => label === `Open ${requestTitle}`);
    await page.getByRole("link", { name: "Public request settings", exact: true }).click();
    await page.getByRole("heading", { name: "Public request", exact: true }).waitFor();
    const remapDialog = page.locator("section#public-request");
    await remapDialog.getByRole("combobox", { name: `Edit ${serviceName} group`, exact: true }).click();
    const remapSearch = page.getByRole("combobox", { name: `Search ${serviceName} group`, exact: true });
    await remapSearch.fill(firstGroup);
    await page.getByRole("option", { name: firstGroup, exact: true }).click();
    await remapSearch.waitFor({ state: "detached" });
    const stateAfterRemap = await page.evaluate(async (api) => {
      const response = await fetch(api + "/api/workspace");
      if (!response.ok) throw new Error("Isolated workspace read failed: " + response.status);
      return response.json();
    }, API);
    const savedService = stateAfterRemap.catalog.services.find((item) => item.name === serviceName);
    expect(row, "saved-service-remapped-before-approval", savedService && { department: savedService.department, group: savedService.subTeam }, (mapping) => mapping.department === department.id && mapping.group === firstGroup);
    await shot(page, row, "service-remapped");
    await page.goto(W + "/requests", { waitUntil: "domcontentloaded" });
    await ready(page);

    const pending = page.locator(".request-row").filter({ has: requestOpen });
    await pending.waitFor();
    await requestOpen.click();
    const detail = page.getByRole("dialog");
    await detail.getByRole("button", { name: "Approve and route", exact: true }).click();
    await detail.waitFor({ state: "detached" });
    await page.goto(W + "/departments/" + department.id, { waitUntil: "domcontentloaded" });
    await ready(page);
    const card = page.locator(".task-card").filter({ hasText: requestTitle });
    await card.waitFor();
    expect(row, "approved-task-routed-to-remapped-department-group", await card.innerText(), (text) => text.includes(firstGroup) && text.includes(ministryName));
    const finalState = await page.evaluate(async (api) => {
      const response = await fetch(api + "/api/workspace");
      if (!response.ok) throw new Error("Isolated workspace read failed: " + response.status);
      return response.json();
    }, API);
    const routed = finalState.tasks.filter((task) => task.title === requestTitle);
    expect(row, "exactly-one-auto-routed-task", routed.map(({ department: routedDepartment, subTeam }) => ({ department: routedDepartment, subTeam })), (tasks) => tasks.length === 1 && tasks[0].department === department.id && tasks[0].subTeam === firstGroup);
    await shot(page, row, "approved-auto-routed");
  });
}

async function memberManagementJourney() {
  await pageCase("members.invite-edit-duty-groups-leadership", "members", "desktop", async ({ row, fixture, page }) => {
    let memberName = "Grace Ndlovu";
    const email = "coverage-invited@example.org";
    const memberEmail = "grace.sound@example.org";
    const departmentName = "Coverage Members";
    const department = await createDepartmentAndGroups(page, departmentName, "Member Alpha", "Member Beta");
    await page.goto(W + "/settings#members", { waitUntil: "domcontentloaded" });
    await ready(page);
    const soundGroup = await page.evaluate(async (api) => {
      const response = await fetch(api + "/api/workspace");
      if (!response.ok) throw new Error("Isolated workspace read failed: " + response.status);
      const state = await response.json();
      return state.catalog.departments.find((item) => item.id === "sound")?.groups[0] ?? "";
    }, API);
    if (!soundGroup) throw new Error("Seed Sound department requires one group for the department-change setup");

    await page.getByRole("button", { name: "Invite member", exact: true }).click();
    const invite = page.locator("form.members-form").first();
    await invite.getByLabel("Full name").fill(memberName);
    await invite.getByLabel("Email address").fill(email);
    await invite.getByLabel("Duty").fill("Sound assistant");
    await invite.locator("select").selectOption("sound");
    await invite.getByRole("checkbox", { name: soundGroup, exact: true }).check();
    const inviteLeader = invite.getByRole("switch", { name: "Invite member as a leader" });
    await inviteLeader.focus();
    await inviteLeader.press("Space");
    fixture.faults.set("POST /api/actions", { status: 503, remaining: 1, delay: 650, message: "coverage invite failed" });
    const submitInvite = invite.getByRole("button", { name: "Invite member", exact: true });
    await submitInvite.click();
    const busy = invite.getByRole("button", { name: "Inviting…", exact: true });
    await busy.waitFor();
    expect(row, "invite-mutation-busy-disabled", await busy.isDisabled(), Boolean);
    await shot(page, row, "invite-busy");
    const failure = page.getByRole("alert").filter({ hasText: "coverage invite failed" });
    await failure.waitFor();
    expect(row, "invite-failure-visible", await failure.innerText(), (text) => text.includes("coverage invite failed"));
    await shot(page, row, "invite-error");
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await page.getByText("Invitation ready to share", { exact: true }).waitFor();
    expect(row, "invitation-link-present-and-email-bound", await page.getByLabel("Workspace sign-in link").inputValue(), (link) => link.endsWith("/login"));
    expect(row, "invitation-not-reported-as-email-sent", await page.locator(".members-invite-ready").innerText(), (text) => /No email was sent/.test(text) && text.includes(email));
    await shot(page, row, "invite-recovered");

    const memberRow = page.getByRole("row").filter({ hasText: memberEmail });
    await memberRow.waitFor();
    const memberNameEditor = memberRow.getByLabel(`Name for ${memberName}`);
    expect(row, "member-name-cell-is-persistent-single-line-textbox", {
      role: await memberNameEditor.getAttribute("role"),
      contentEditable: await memberNameEditor.getAttribute("contenteditable"),
      multiline: await memberNameEditor.getAttribute("aria-multiline"),
    }, (value) => value.role === "textbox" && value.contentEditable === "true" && value.multiline === "false");
    await memberNameEditor.fill("Discarded name draft");
    await memberNameEditor.press("Escape");
    expect(row, "member-name-escape-restores-baseline", await memberNameEditor.innerText(), (text) => text === memberName);
    await memberNameEditor.focus();
    const tabbedName = `${memberName} Tabbed`;
    await memberNameEditor.fill(tabbedName);
    await memberNameEditor.press("Tab");
    await memberRow.getByLabel(`Name for ${tabbedName}`).waitFor();
    memberName = tabbedName;
    const tabFocusLabel = `Edit ${memberName} duty`;
    await page.waitForTimeout(60);
    const tabFocus60 = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
    await page.waitForTimeout(300);
    const tabFocus300 = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
    expect(row, "member-name-tab-commit-focus-at-60ms", tabFocus60, (label) => label === tabFocusLabel);
    expect(row, "member-name-tab-commit-focus-stable-at-300ms", tabFocus300, (label) => label === tabFocusLabel);

    const renamedMember = `${memberName} Updated`;
    const renamedMemberEditor = memberRow.getByLabel(`Name for ${memberName}`);
    await renamedMemberEditor.fill(renamedMember);
    fixture.faults.set("POST /api/actions", { status: 503, remaining: 1, delay: 650, message: "coverage member name failed" });
    await renamedMemberEditor.press("Enter");
    const nameError = memberRow.getByRole("alert");
    await nameError.waitFor();
    expect(row, "member-name-error-preserves-editable-draft", {
      error: await nameError.innerText(),
      draft: await renamedMemberEditor.innerText(),
      busy: await renamedMemberEditor.getAttribute("aria-busy"),
    }, (value) => value.error.includes("coverage member name failed") && value.draft === renamedMember && value.busy !== "true");
    await shot(page, row, "member-name-error-draft");
    await renamedMemberEditor.press("Enter");
    await memberRow.getByLabel(`Name for ${renamedMember}`).waitFor();
    memberName = renamedMember;
    const dutyLabel = `Edit ${memberName} duty`;
    await memberRow.getByRole("combobox", { name: dutyLabel, exact: true }).click();
    const duty = page.getByRole("combobox", { name: `Search ${memberName} duty`, exact: true });
    await duty.waitFor();
    const dutyPopup = page.getByRole("listbox").last();
    const originalDuty = await memberRow.locator('td[data-label="Duty"]').innerText();
    await duty.fill(originalDuty);
    const duplicateDutyOption = dutyPopup.getByRole("option", { name: "Create new duty", exact: true });
    await duplicateDutyOption.waitFor();
    expect(row, "member-duty-duplicate-create-disabled", {
      createLabel: await duplicateDutyOption.innerText(),
      disabled: await duplicateDutyOption.getAttribute("aria-disabled"),
    }, (value) => value.createLabel === "Create new duty" && value.disabled === "true");
    await duty.press("Escape");
    await memberRow.getByRole("combobox", { name: dutyLabel, exact: true }).waitFor();
    await page.waitForTimeout(60);
    const escapeFocus60 = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
    await page.waitForTimeout(300);
    const escapeFocus300 = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
    expect(row, "member-duty-escape-focus-at-60ms", escapeFocus60, (label) => label === dutyLabel);
    expect(row, "member-duty-escape-focus-stable-at-300ms", escapeFocus300, (label) => label === dutyLabel);

    await memberRow.getByRole("combobox", { name: dutyLabel, exact: true }).click();
    await duty.fill("Discarded inline duty");
    await duty.press("Escape");
    await memberRow.getByRole("combobox", { name: dutyLabel, exact: true }).waitFor();

    await memberRow.getByRole("combobox", { name: dutyLabel, exact: true }).click();
    await duty.fill("Production lead");
    fixture.faults.set("POST /api/actions", { status: 503, remaining: 1, delay: 650, message: "coverage member duty failed" });
    const productionDutyOption = dutyPopup.getByRole("option", { name: "Create new duty", exact: true });
    await duty.press("ArrowDown");
    await duty.press("Enter");
    const dutyEditor = page.getByRole("listbox").last().locator("xpath=..");
    await dutyEditor.waitFor();
    expect(row, "member-duty-editor-busy", await dutyEditor.getAttribute("aria-busy"), (value) => value === "true");
    expect(row, "member-duty-search-disabled-while-saving", await duty.isDisabled(), Boolean);
    await shot(page, row, "duty-busy");
    const dutyError = dutyEditor.getByRole("alert");
    await dutyError.waitFor();
    expect(row, "member-duty-error-preserves-retry-draft", { error: await dutyError.innerText(), value: await duty.inputValue() }, (value) => value.error.includes("coverage member duty failed") && value.value === "Production lead");
    await shot(page, row, "duty-error-draft");
    await productionDutyOption.click();
    await dutyPopup.waitFor({ state: "detached" });
    await memberRow.getByRole("combobox", { name: dutyLabel, exact: true }).getByText("Production lead", { exact: true }).waitFor();
    await page.waitForTimeout(60);
    const saveFocus60 = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
    await page.waitForTimeout(300);
    const saveFocus300 = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
    expect(row, "member-duty-save-focus-at-60ms", saveFocus60, (label) => label === dutyLabel);
    expect(row, "member-duty-save-focus-stable-at-300ms", saveFocus300, (label) => label === dutyLabel);

    const departmentLabel = `Edit ${memberName} department`;
    await memberRow.getByRole("combobox", { name: departmentLabel, exact: true }).click();
    const departmentSearch = page.getByRole("combobox", { name: `Search ${memberName} department`, exact: true });
    await departmentSearch.waitFor();
    const departmentOptions = page.getByRole("listbox").last();
    const departmentPopup = departmentOptions.locator("xpath=..");
    await departmentSearch.fill(departmentName);
    const departmentOption = departmentOptions.getByRole("option", { name: new RegExp(departmentName) });
    await departmentOption.waitFor();
    expect(row, "member-department-option-is-compact", await departmentOption.innerText(), (text) => text.trim() === departmentName && !/Groups:/i.test(text));
    fixture.faults.set("POST /api/actions", { status: 503, remaining: 1, delay: 650, message: "coverage member department failed" });
    await departmentOption.click();
    const departmentError = departmentPopup.getByRole("alert");
    await departmentError.waitFor();
    expect(row, "member-department-error-preserves-selection", { error: await departmentError.innerText(), value: await departmentSearch.inputValue() }, (value) => value.error.includes("coverage member department failed") && value.value === departmentName);
    await shot(page, row, "department-error-draft");
    await departmentOption.click();
    await departmentPopup.waitFor({ state: "detached" });
    await memberRow.getByRole("combobox", { name: departmentLabel, exact: true }).getByText(departmentName, { exact: true }).waitFor();

    const groupsLabel = `Edit ${memberName} groups`;
    await memberRow.getByRole("combobox", { name: groupsLabel, exact: true }).click();
    const groupsSearch = page.getByRole("combobox", { name: `Search ${memberName} groups`, exact: true });
    const groupsOptions = page.getByRole("listbox").last();
    const groupsPopup = groupsOptions.locator("xpath=..");
    await groupsSearch.waitFor();
    await groupsSearch.fill("Member Alpha");
    const alpha = groupsOptions.getByRole("option", { name: "Member Alpha", exact: true });
    await alpha.waitFor();
    await alpha.click();
    const emptyGroupsError = groupsPopup.getByRole("alert");
    await emptyGroupsError.waitFor();
    expect(row, "member-groups-require-at-least-one-selection", { error: await emptyGroupsError.innerText(), query: await groupsSearch.inputValue() }, (value) => value.error.includes("Choose at least one group") && value.query === "Member Alpha");
    await groupsSearch.press("Escape");
    await memberRow.getByRole("combobox", { name: groupsLabel, exact: true }).waitFor();

    await memberRow.getByRole("combobox", { name: groupsLabel, exact: true }).click();
    const groupsRetry = page.getByRole("combobox", { name: `Search ${memberName} groups`, exact: true });
    const groupsRetryOptions = page.getByRole("listbox").last();
    const groupsRetryPopup = groupsRetryOptions.locator("xpath=..");
    await groupsRetry.waitFor();
    await groupsRetry.fill("Member Gamma");
    const createGroup = groupsRetryOptions.getByRole("option", { name: "Create new group", exact: true });
    await createGroup.waitFor();
    expect(row, "member-group-create-footer-is-concise", await createGroup.innerText(), (text) => text.trim() === "Create new group");
    fixture.faults.set("POST /api/actions", { status: 503, remaining: 1, delay: 650, message: "coverage member groups failed" });
    await createGroup.click();
    const groupsError = groupsRetryPopup.getByRole("alert");
    await groupsError.waitFor();
    expect(row, "member-groups-error-preserves-create-draft", { error: await groupsError.innerText(), query: await groupsRetry.inputValue() }, (value) => value.error.includes("coverage member groups failed") && value.query === "Member Gamma");
    await shot(page, row, "groups-error-draft");
    await createGroup.click();
    await memberRow.getByRole("combobox", { name: groupsLabel, exact: true }).getByText("Member Gamma", { exact: true }).waitFor();
    await groupsRetry.fill("Member Gamma");
    const duplicateGroupOption = groupsRetryPopup.getByRole("option", { name: "Create new group", exact: true });
    await duplicateGroupOption.waitFor();
    expect(row, "member-group-duplicate-create-disabled", {
      createLabel: await duplicateGroupOption.innerText(),
      disabled: await duplicateGroupOption.getAttribute("aria-disabled"),
    }, (value) => value.createLabel === "Create new group" && value.disabled === "true");
    await groupsRetry.press("Escape");
    await memberRow.getByRole("combobox", { name: groupsLabel, exact: true }).waitFor();

    await memberRow.getByRole("combobox", { name: groupsLabel, exact: true }).click();
    const groupsSelection = page.getByRole("combobox", { name: `Search ${memberName} groups`, exact: true });
    const groupsSelectionPopup = page.getByRole("listbox").last();
    await groupsSelection.fill("Member Beta");
    await groupsSelectionPopup.getByRole("option", { name: "Member Beta", exact: true }).click();
    await memberRow.getByRole("combobox", { name: groupsLabel, exact: true }).getByText("Member Beta", { exact: true }).waitFor();
    await groupsSelection.fill("Member Alpha");
    await groupsSelectionPopup.getByRole("option", { name: "Member Alpha", exact: true }).click();
    await page.waitForFunction((label) => {
      const trigger = document.querySelector(`[aria-label="${CSS.escape(label)}"]`);
      const value = trigger?.textContent ?? "";
      return value.includes("Member Beta") && value.includes("Member Gamma") && !value.includes("Member Alpha");
    }, groupsLabel);
    await groupsSelection.press("Escape");
    await memberRow.getByRole("combobox", { name: groupsLabel, exact: true }).waitFor();

    const leaderSwitch = memberRow.getByRole("switch", { name: memberName + " leader role" });
    expect(row, "member-duty-department-and-groups-updated", await memberRow.innerText(), (text) => text.includes("Production lead") && text.includes(departmentName) && text.includes("Member Beta") && text.includes("Member Gamma") && !text.includes("Member Alpha"));
    await leaderSwitch.focus();
    await leaderSwitch.press("Space");
    await page.waitForFunction((name) => document.querySelector(`input[role="switch"][aria-label="${name} leader role"]`)?.getAttribute("aria-checked") === "false", memberName);
    expect(row, "leadership-can-be-toggled-separately-by-keyboard", await leaderSwitch.getAttribute("aria-checked"), (value) => value === "false");
    const accessSwitch = memberRow.getByRole("switch", { name: `${memberName} workspace access` });
    await accessSwitch.focus();
    await accessSwitch.press("Space");
    await page.waitForFunction((name) => document.querySelector(`input[role="switch"][aria-label="${name} workspace access"]`)?.getAttribute("aria-checked") === "false", memberName);
    expect(row, "workspace-access-revoke-switch-state", await accessSwitch.getAttribute("aria-checked"), (value) => value === "false");
    await accessSwitch.focus();
    await accessSwitch.press("Space");
    await page.waitForFunction((name) => document.querySelector(`input[role="switch"][aria-label="${name} workspace access"]`)?.getAttribute("aria-checked") === "true", memberName);
    expect(row, "workspace-access-restore-switch-state", await accessSwitch.getAttribute("aria-checked"), (value) => value === "true");
    const finalState = await page.evaluate(async (api) => {
      const response = await fetch(api + "/api/workspace");
      if (!response.ok) throw new Error("Isolated workspace read failed: " + response.status);
      return response.json();
    }, API);
    const saved = finalState.users.find((member) => member.email === memberEmail);
    const savedDepartment = finalState.catalog.departments.find((item) => item.id === department.id);
    expect(row, "member-contract-persisted", saved && { name: saved.name, duty: saved.duty, department: saved.department, groups: saved.groups, isLeader: saved.isLeader, approved: saved.approved, catalogGroups: savedDepartment?.groups }, (member) => member.name === memberName && member.duty === "Production lead" && member.department === department.id && member.groups.includes("Member Beta") && member.groups.includes("Member Gamma") && !member.groups.includes("Member Alpha") && member.catalogGroups.includes("Member Gamma") && !member.isLeader && member.approved);
    expect(row, "member-cell-failures-were-injected", fixture.injected.filter((item) => item.key === "POST /api/actions" && item.status === 503).length >= 5, Boolean);
    await shot(page, row, "member-updated");
  });
}

async function portalBranches() {
  await pageCase("portal.aired-date.validation-and-multiple", "portal", "narrow", async ({ row, page }) => {
    await page.goto(P, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /Make a request/i }).click();
    const selects = page.locator(".request-form select");
    await page.waitForFunction(() => {
      const requestType = document.querySelector(".request-form select");
      return requestType && !requestType.disabled && [...requestType.options].some((option) => Boolean(option.value) && /previously aired/i.test(option.textContent || ""));
    });
    const options = await selects.nth(0).locator("option").evaluateAll((nodes) => nodes.map((n) => ({ value: n.value, label: n.textContent || "" })));
    const service = options.find((o) => /previously aired/i.test(o.label));
    if (!service) throw new Error("Aired date service missing in catalog");
    await selects.nth(0).selectOption(service.value);
    await page.waitForFunction(() => (document.querySelectorAll(".request-form select")[1]?.options.length ?? 0) > 1);
    const ministries = await selects.nth(1).locator("option").evaluateAll((nodes) => nodes.map((n) => ({ value: n.value, label: n.textContent || "" })));
    const ministry = ministries.find((option) => Boolean(option.value));
    if (!ministry) throw new Error("Aired date ministry missing in catalog");
    await selects.nth(1).selectOption(ministry.value);
    await page.getByPlaceholder("e.g. Youth retreat recap video").fill("coverage aired dates");
    await page.getByPlaceholder("Describe what you need…").fill("Aired date fixture.");
    await page.getByPlaceholder("Anything else we should know?").fill("Disposable API.");
    const due = new Date(Date.now() + 7 * 86400000);
    await page.locator('input[type="datetime-local"]').fill(due.getFullYear() + "-" + String(due.getMonth() + 1).padStart(2, "0") + "-" + String(due.getDate()).padStart(2, "0") + "T12:00");
    await page.getByRole("button", { name: "Next", exact: true }).click();
    const airedError = page.getByText(/Add at least one exact aired date/i);
    await airedError.waitFor();
    expect(row, "missing-aired-date-error", await airedError.innerText(), (x) => x.includes("Add at least one exact aired date"));
    expect(row, "missing-aired-date-focus-fallback", await page.evaluate(() => ({
      id: document.activeElement?.getAttribute("id"),
      label: document.activeElement?.getAttribute("aria-label"),
      name: document.activeElement?.getAttribute("name"),
      text: document.activeElement?.textContent?.trim(),
    })), (x) => x.id === "aired-date-0" || x.id === "add-aired-date");
    const airedRelation = await page.getByRole("group", { name: "Exact aired dates" }).evaluate((group) => {
      const ids = (group.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean);
      return ids.some((id) => {
        const node = document.getElementById(id);
        return Boolean(node && /Add at least one exact aired date/i.test(node.textContent || "") && node.getClientRects().length);
      });
    });
    expect(row, "aired-validation-error-is-described", airedRelation, Boolean);
    await shot(page, row, "validation");
    await page.getByRole("button", { name: /Add exact date/i }).click();
    await page.locator(".aired-date-row input[type=date]").first().fill(new Date(Date.now() - 86400000).toISOString().slice(0, 10));
    if (await page.locator(".aired-date-row").count() < 2) await page.getByRole("button", { name: /Add exact date/i }).click();
    expect(row, "two-aired-date-controls", await page.locator(".aired-date-row").count(), (n) => n === 2);
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await page.getByRole("heading", { name: /Step 2: Review and confirm/i }).waitFor();
    expect(row, "aired-date-review", await page.locator(".request-review").innerText(), (x) => x.includes("Exact aired dates"));
    await shot(page, row, "review");
  });
  await pageCase("portal.tracking.pending-and-clipboard-denied", "portal", "desktop", async ({ row, fixture, page }) => {
    const trackRequests = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/track") trackRequests.push(request.method());
    });
    await fixture.context.addInitScript(() => { Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new Error("denied"); } } }); });
    await formBasics(page, "coverage tracking privacy", false, row);
    await page.getByRole("button", { name: "Send request", exact: true }).click();
    await page.locator(".request-success").waitFor();
    const code = (await page.locator(".access-code").innerText()).trim();
    await page.getByRole("button", { name: /Copy private access code/i }).click();
    const fallback = page.getByRole("textbox", { name: "Private access code for manual copying" });
    await fallback.waitFor();
    expect(row, "clipboard-denial-guidance", await fallback.inputValue(), (x) => x === code);
    await shot(page, row, "clipboard-denied");
    await page.getByRole("button", { name: /Track this request/i }).click();
    await page.locator(".tracking-summary").waitFor();
    expect(row, "pending-edit-enabled", await page.getByRole("button", { name: "Save changes", exact: true }).count(), (n) => n === 1);
    expect(row, "tracking-code-not-in-url", page.url(), (x) => !x.includes(code));
    expect(row, "pending-status-only", await page.locator(".tracking-summary").innerText(), (text) => /Awaiting review/.test(text) && !/\d+%/.test(text));
    await shot(page, row, "pending");
    const callsBeforeReference = trackRequests.length;
    await page.locator("#tracking-code").fill("MOC-2026-0001");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    const referenceError = page.getByRole("alert");
    await referenceError.waitFor();
    expect(row, "request-reference-explains-private-code", await referenceError.innerText(), (text) => /request reference/.test(text) && /private access code/.test(text));
    const referenceErrorPosition = await referenceError.evaluate((alert) => {
      const form = document.querySelector(".track-form");
      if (!form) return { below: false, described: false };
      const formRect = form.getBoundingClientRect();
      const alertRect = alert.getBoundingClientRect();
      const input = form.querySelector("#tracking-code");
      const describedBy = input?.getAttribute("aria-describedby")?.split(/\s+/) ?? [];
      return { below: alertRect.top >= formRect.bottom - 1, described: describedBy.includes(alert.id) };
    });
    expect(row, "tracking-error-is-described-below-form", referenceErrorPosition, (value) => value.below && value.described);
    expect(row, "request-reference-never-submitted-as-access-code", trackRequests.length - callsBeforeReference, (count) => count === 0);
    await shot(page, row, "request-reference-error-below-form");
  });
  await pageCase("portal.tracking.approved-in-progress-complete-rejected", "portal", "desktop", async ({ row, fixture }) => {
    const portal = await fixture.context.newPage();
    await formBasics(portal, "coverage terminal status approved", false, row, /Video creation/i);
    await portal.getByRole("button", { name: "Send request", exact: true }).click();
    await portal.locator(".request-success").waitFor();
    const approvedCode = (await portal.locator(".access-code").innerText()).trim();
    const workspace = await fixture.context.newPage();
    await workspace.goto(W, { waitUntil: "domcontentloaded" });
    await ready(workspace);
    await workspace.goto(W + "/requests", { waitUntil: "domcontentloaded" });
    await requestTrigger(workspace, "coverage terminal status approved").click();
    await workspace.getByRole("button", { name: "Approve and route" }).click();
    await workspace.getByRole("heading", { name: "Requests" }).waitFor();
    await portal.goto(P, { waitUntil: "domcontentloaded" });
    await portal.getByRole("button", { name: /Track a submission/i }).click();
    await portal.getByLabel("Private access code").fill(approvedCode);
    await portal.getByRole("button", { name: "Search", exact: true }).click();
    await portal.locator(".tracking-summary").waitFor();
    expect(row, "approved-not-started-branch", await portal.locator(".tracking-summary").innerText(), (x) => /Approved/.test(x) && !/\d+%/.test(x));
    await shot(portal, row, "approved");
    await workspace.goto(W + "/departments/visual-media", { waitUntil: "domcontentloaded" });
    await workspace.locator(".task-card-open").filter({ hasText: "coverage terminal status approved" }).click();
    await workspace.getByRole("button", { name: "In progress", exact: true }).click();
    await workspace.getByRole("heading", { name: "Visual Media" }).waitFor();
    await portal.getByLabel("Private access code").fill(approvedCode);
    await portal.getByRole("button", { name: "Search", exact: true }).click();
    await portal.locator(".tracking-summary").waitFor();
    expect(row, "approved-in-progress-branch", await portal.locator(".tracking-summary").innerText(), (x) => /In progress/.test(x) && !/\d+%/.test(x));
    await shot(portal, row, "in-progress");
    await workspace.locator(".task-card-open").filter({ hasText: "coverage terminal status approved" }).click();
    await workspace.getByRole("button", { name: "Complete", exact: true }).click();
    await workspace.getByRole("heading", { name: "Visual Media" }).waitFor();
    await portal.getByLabel("Private access code").fill(approvedCode);
    await portal.getByRole("button", { name: "Search", exact: true }).click();
    await portal.locator(".tracking-summary").waitFor();
    expect(row, "completed-terminal-branch", await portal.locator(".tracking-summary").innerText(), (x) => /Completed/.test(x));
    await shot(portal, row, "completed");
    const rejected = await fixture.context.newPage();
    await formBasics(rejected, "coverage terminal status rejected", false, row);
    await rejected.getByRole("button", { name: "Send request", exact: true }).click();
    await rejected.locator(".request-success").waitFor();
    const rejectedCode = (await rejected.locator(".access-code").innerText()).trim();
    await workspace.goto(W + "/requests", { waitUntil: "domcontentloaded" });
    await requestTrigger(workspace, "coverage terminal status rejected").click();
    await workspace.getByRole("button", { name: "Reject request" }).click();
    await workspace.getByLabel("Reason for rejection").fill("Please clarify the requested delivery format.");
    await workspace.getByRole("button", { name: "Reject request" }).click();
    await workspace.getByRole("heading", { name: "Requests" }).waitFor();
    await rejected.goto(P, { waitUntil: "domcontentloaded" });
    await rejected.getByRole("button", { name: /Track a submission/i }).click();
    await rejected.getByLabel("Private access code").fill(rejectedCode);
    await rejected.getByRole("button", { name: "Search", exact: true }).click();
    await rejected.locator(".tracking-summary").waitFor();
    expect(row, "rejected-status-and-reason", await rejected.locator(".tracking-summary").innerText(), (x) => /Not approved/.test(x) && /clarify the requested delivery format/.test(x));
    await shot(rejected, row, "rejected");
  });
}

async function lifecycleCoverage() {
  await pageCase("lifecycle.rejected-request-can-be-approved", "lifecycle", "desktop", async ({ row, page }) => {
    await page.goto(W + "/requests", { waitUntil: "domcontentloaded" });
    await ready(page);
    const filters = page.getByRole("group", { name: "Filter requests by status", exact: true });
    await filters.getByRole("button", { name: /^Rejected · \d+$/ }).click();
    const open = page.locator(".requests-data-table tbody").getByRole("button", { name: /^Open / }).first();
    const title = (await open.innerText()).trim();
    const before = await page.evaluate(async (api) => fetch(api + "/api/workspace").then((response) => response.json()), API);
    const original = before.requests.find((request) => request.title === title);
    await open.click();
    const detail = page.getByRole("dialog", { name: "Request details", exact: true });
    await detail.waitFor();
    expect(row, "rejected-request-offers-approval-only", { approve: await detail.getByRole("button", { name: "Approve and route", exact: true }).count(), reject: await detail.getByRole("button", { name: "Reject request", exact: true }).count() }, (value) => value.approve === 1 && value.reject === 0);
    await detail.getByRole("button", { name: "Approve and route", exact: true }).click();
    await detail.waitFor({ state: "detached" });
    const after = await page.evaluate(async (api) => fetch(api + "/api/workspace").then((response) => response.json()), API);
    const saved = after.requests.find((request) => request.id === original.id);
    const task = after.tasks.find((task) => task.requestId === original.id);
    expect(row, "rejected-request-becomes-approved-and-routed-once", { status: saved.status, tasks: after.tasks.filter((item) => item.requestId === original.id).length, taskStatus: task?.status }, (value) => value.status === "approved" && value.tasks === 1 && value.taskStatus === "pending");
    expect(row, "decision-history-retains-rejection-and-records-approval", saved.lifecycle, (value) => value.rejectedAt === original.lifecycle.rejectedAt && Number.isFinite(Date.parse(value.approvedAt)) && value.receivedAt === original.lifecycle.receivedAt);
    const resetStatus = await page.evaluate(async ({ api, requestId }) => fetch(api + "/api/actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "update-request", requestId, status: "backlog" }) }).then((response) => response.status), { api: API, requestId: saved.id });
    expect(row, "reviewed-request-cannot-return-to-backlog", resetStatus, (status) => status === 400);
    await filters.getByRole("button", { name: /^Approved · \d+$/ }).click();
    await page.getByRole("button", { name: `Open ${title}`, exact: true }).waitFor();
    await shot(page, row, "approved-after-rejection");
  });

  await pageCase("lifecycle.report-milestones-and-widgets", "lifecycle", "desktop", async ({ row, fixture, page }) => {
    const now = new Date();
    const date = (day) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day, 10)).toISOString();
    await patchWorkspace(fixture.context, fixture.api.url, (data) => {
      const sourceRequest = data.requests[0];
      const sourceTask = data.tasks[0];
      const fullLifecycle = { receivedAt: date(1), approvedAt: date(2), inProgressAt: date(3), completedAt: date(5) };
      data.requests = [
        { ...sourceRequest, id: "coverage-request-complete", taskId: "coverage-task-complete", title: "Coverage complete lifecycle", createdAt: date(1), updatedAt: date(5), dueAt: date(10), status: "approved", lifecycle: fullLifecycle },
        { ...sourceRequest, id: "coverage-request-rejected", taskId: undefined, title: "Coverage rejected lifecycle", createdAt: date(1), updatedAt: date(2), dueAt: date(10), status: "rejected", lifecycle: { receivedAt: date(1), rejectedAt: date(2) } },
        { ...sourceRequest, id: "coverage-request-backlog", taskId: undefined, title: "Coverage backlog lifecycle", createdAt: date(3), updatedAt: date(3), dueAt: date(10), status: "backlog", lifecycle: { receivedAt: date(3) } },
      ];
      data.tasks = [{ ...sourceTask, id: "coverage-task-complete", requestId: "coverage-request-complete", title: "Coverage complete lifecycle", ministry: sourceRequest.ministry, service: sourceRequest.service, createdAt: date(2), dueAt: date(10), status: "completed", lifecycle: fullLifecycle, privateNotes: [] }];
      data.activities = [];
    });
    await page.goto(W + "/reports", { waitUntil: "domcontentloaded" });
    await ready(page);
    const table = page.locator('[data-slot="data-table"] table');
    const headers = (await table.locator("thead th").allTextContents()).map((value) => value.trim());
    expect(row, "report-base-columns-match-other-work-tables", headers, (value) => value.join("|") === "Task|Ministry|Service|Due date|Group|Department|Status|Received date|Approved date|Rejected date|In progress date|Completed date");
    expect(row, "request-task-join-produces-one-row", await table.locator("tbody tr").count(), (count) => count === 3);
    const completed = table.getByRole("row").filter({ has: page.getByRole("button", { name: "Open Coverage complete lifecycle", exact: true }) });
    for (const label of ["Received date", "Approved date", "In progress date", "Completed date"]) {
      expect(row, "completed-row-records-" + label.replaceAll(" ", "-"), await completed.locator(`[data-label="${label}"] time`).getAttribute("datetime"), (value) => value === ({ "Received date": date(1), "Approved date": date(2), "In progress date": date(3), "Completed date": date(5) })[label]);
    }
    const backlog = table.getByRole("row").filter({ has: page.getByRole("button", { name: "Open Coverage backlog lifecycle", exact: true }) });
    for (const label of ["Approved date", "Rejected date", "In progress date", "Completed date"]) {
      expect(row, "backlog-missing-" + label.replaceAll(" ", "-"), (await backlog.locator(`[data-label="${label}"]`).innerText()).trim(), (value) => value === "");
    }
    await page.getByRole("heading", { name: "Decisions", exact: true }).waitFor();
    await page.getByRole("heading", { name: "Time between stages", exact: true }).waitFor();
    await page.getByRole("heading", { name: "Weekly request activity", exact: true }).waitFor();
    const stages = page.getByRole("region", { name: "Time between stages", exact: true });
    expect(row, "complete-pairs-only-contribute-to-stage-averages", await stages.locator("dl > div").allTextContents(), (items) => items.length === 3 && items[0].includes("Received") && items[0].includes("Approved") && items[0].includes("1.0 days") && items[1].includes("1.0 days") && items[2].includes("2.0 days") && items.every((text) => text.includes("1 record with both dates")));
    expect(row, "decisions-compare-actual-decision-dates", await page.getByRole("img", { name: "1 approvals and 1 rejections", exact: true }).count(), (count) => count === 1);
    expect(row, "weekly-received-total-uses-lifecycle-date", await page.locator('[aria-label$=", received: 3"]').count(), (count) => count === 1);
    await noOverflow(row, page);
    await shot(page, row, "report-complete-and-missing-milestones");
    await completed.getByRole("button").click();
    const detail = page.getByRole("dialog", { name: "Task details", exact: true });
    await detail.waitFor();
    expect(row, "report-row-opens-shared-floating-drawer", await detail.getAttribute("data-side"), (value) => value === "right");
  });
}

async function denseContent() {
  await pageCase("data.dense-long-dashboard-reports", "dense", "narrow", async ({ row, fixture, page }) => {
    await fixture.context.route(API + "/api/workspace", async (route) => {
      const response = await route.fetch({ url: fixture.api.url + "/api/workspace" });
      const data = await response.json();
      const base = data.tasks[0];
      if (!base) throw new Error("Seed task required for a realistic dense fixture");
      const paletteDepartments = data.catalog.departments.filter((department) => department.groups?.length).slice(0, 4);
      if (paletteDepartments.length < 4) throw new Error("Four grouped departments are required for palette coverage");
      ["pink", "purple", "amber", "blue"].forEach((color, index) => { paletteDepartments[index].color = color; });
      const longTitle = "Very long ministry production task title used to verify wrapping and narrow screen access";
      data.tasks = Array.from({ length: 80 }, (_, i) => ({
        ...base,
        id: "coverage-dense-" + i,
        title: longTitle + " " + i,
        department: paletteDepartments[i % paletteDepartments.length].id,
        subTeam: paletteDepartments[i % paletteDepartments.length].groups[0],
        status: i % 4 === 0 ? "completed" : "in-progress",
        dueAt: new Date(Date.now() + i * 3600000).toISOString(),
        lifecycle: { receivedAt: base.createdAt, inProgressAt: base.createdAt, ...(i % 4 === 0 ? { completedAt: new Date().toISOString() } : {}) },
        privateNotes: [],
      }));
      data.requests = [];
      data.activities = [];
      await route.fulfill({ response, json: data });
    });
    await page.goto(W, { waitUntil: "domcontentloaded" });
    await ready(page);
    await noOverflow(row, page);
    await shot(page, row, "dashboard");
    await page.goto(W + "/reports", { waitUntil: "domcontentloaded" });
    await ready(page);
    await noOverflow(row, page);
    const reportTable = page.locator('[data-slot="data-table"] table');
    const reportHeaders = (await reportTable.locator("thead th").allTextContents()).map((value) => value.trim());
    expect(row, "reports-render-each-field-as-a-separate-column", reportHeaders, (headers) => headers.join("|") === "Task|Ministry|Service|Due date|Group|Department|Status|Received date|Approved date|Rejected date|In progress date|Completed date");
    const reportBadges = await reportTable.locator('[data-label="Department"] .badge, [data-label="Group"] .badge').evaluateAll((nodes) => {
      const channels = (value) => (value.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
      const luminance = (value) => {
        const [r, g, b] = channels(value).map((channel) => channel / 255).map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      return nodes.map((node) => {
        const style = getComputedStyle(node);
        const fg = luminance(style.color);
        const bg = luminance(style.backgroundColor);
        return { background: style.backgroundColor, contrast: (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05) };
      });
    });
    expect(row, "reports-badges-have-readable-foregrounds-across-palettes", reportBadges, (items) => new Set(items.map((item) => item.background)).size >= 4 && items.every((item) => item.contrast >= 4.5));
    await shot(page, row, "reports");
    expect(row, "dense-fixture-volume", await page.locator("body").innerText(), (x) => x.includes("Very long ministry"));

    // A dense same-day calendar cell exercises the real month overflow affordance
    // and its expanded day list. This is one reachable dense-data branch, not a
    // generated Cartesian matrix of all possible schedule combinations.
    await fixture.context.route(API + "/api/workspace", async (route) => {
      const response = await route.fetch({ url: fixture.api.url + "/api/workspace" });
      const data = await response.json();
      const base = data.tasks[0];
      if (!base) throw new Error("Seed task required for a realistic dense calendar fixture");
      const day = new Date();
      day.setHours(12, 0, 0, 0);
      data.tasks = Array.from({ length: 18 }, (_, i) => ({
        ...base,
        id: "coverage-calendar-dense-" + i,
        title: "Same-day long production deadline " + String(i + 1).padStart(2, "0"),
        ministry: "Coverage ministry",
        dueAt: new Date(day.getTime() + i * 60000).toISOString(),
        status: i % 3 === 0 ? "completed" : i % 3 === 1 ? "in-progress" : "pending",
        lifecycle: { receivedAt: base.createdAt, ...(i % 3 !== 2 ? { inProgressAt: base.createdAt } : {}), ...(i % 3 === 0 ? { completedAt: new Date(day.getTime()).toISOString() } : {}) },
        privateNotes: [],
      }));
      data.requests = [];
      data.activities = [];
      await route.fulfill({ response, json: data });
    });
    // Open on a new document so the isolated route receives a fresh workspace
    // query instead of reusing the dashboard/reports query cache.
    const calendar = await fixture.context.newPage();
    await calendar.goto(W + "/calendar", { waitUntil: "domcontentloaded" });
    await ready(calendar);
    const denseDay = calendar.getByRole("button", { name: /18 items/ });
    await denseDay.waitFor();
    await denseDay.click();
    const dayDialog = calendar.getByRole("dialog");
    await dayDialog.waitFor();
    expect(row, "all-dense-day-events-rendered", await dayDialog.locator(".schedule-event-row").count(), (n) => n === 18);
    await noOverflow(row, calendar);
    await shot(calendar, row, "calendar-dense-day-expanded");
  });
}

async function keyboardAndErrors() {
  await pageCase("keyboard.portal-first-invalid-and-described-error", "keyboard", "narrow", async ({ row, page }) => {
    await page.goto(P, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /Make a request/i }).click();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    const focus = await page.evaluate(() => ({
      name: document.activeElement?.getAttribute("name"),
      tag: document.activeElement?.tagName,
      describedby: document.activeElement?.getAttribute("aria-describedby"),
    }));
    expect(row, "focus-first-invalid-request-type", focus, (x) => x.tag === "SELECT" && x.name === "service");
    const relation = await page.locator('[name="service"]').evaluate((element) => {
      const ids = (element.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean);
      return { ids, visible: ids.length > 0 && ids.every((id) => {
        const node = document.getElementById(id);
        return Boolean(node && node.getClientRects().length);
      }) };
    });
    expect(row, "visible-error-linked", relation, (x) => x.visible);
    await shot(page, row);
  });
  await pageCase("keyboard.mobile-drawer-trap-restore", "keyboard", "narrow", async ({ row, page }) => {
    await page.goto(W, { waitUntil: "domcontentloaded" });
    await ready(page);
    await page.getByRole("button", { name: "Open navigation" }).click();
    await page.getByRole("dialog").waitFor();
    const focus = await settledFocusCycle(page);
    expect(row, "focus-inside-after-popup-settles", focus.afterPopupSettled300ms, Boolean);
    expect(row, "dialog-focus-wraps-at-60ms", focus.after60ms, (x) => x.every(Boolean));
    expect(row, "dialog-focus-wraps-at-300ms", focus.after300ms, (x) => x.every(Boolean));
    await page.keyboard.press("Escape");
    const restore = await settledFocusRestore(page, 'button[aria-label="Open navigation"]');
    expect(row, "focus-restored-at-60ms", restore.after60ms, Boolean);
    expect(row, "focus-restored-at-300ms", restore.after300ms, Boolean);
    await shot(page, row, "closed");
  });
  await pageCase("keyboard.task-detail-trap-restore-and-comment-draft", "keyboard", "desktop", async ({ row, page }) => {
    await page.goto(W + "/departments/sound", { waitUntil: "domcontentloaded" });
    await ready(page);
    const trigger = page.locator(".task-card-open").first();
    await trigger.click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    await page.waitForTimeout(300);
    expect(row, "initial-focus-inside-detail-after-settle", await page.evaluate(() => Boolean(document.querySelector('[role="dialog"]')?.contains(document.activeElement))), Boolean);
    const focus = await settledFocusCycle(page);
    expect(row, "focus-inside-after-popup-settles", focus.afterPopupSettled300ms, Boolean);
    expect(row, "detail-focus-wraps-at-60ms", focus.after60ms, (x) => x.every(Boolean));
    expect(row, "detail-focus-wraps-at-300ms", focus.after300ms, (x) => x.every(Boolean));
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    const restore = await settledFocusRestore(page, ".task-card-open");
    expect(row, "detail-close-restores-trigger-at-60ms", restore.after60ms, Boolean);
    expect(row, "detail-close-restores-trigger-at-300ms", restore.after300ms, Boolean);

    await trigger.click();
    await page.getByRole("dialog").waitFor();
    const comment = page.locator('textarea[id^="comment-"]');
    await comment.waitFor();
    expect(row, "task-comments-follow-details-without-tabs", { tabs: await page.locator(".task-detail-tabs").count(), titleVisible: await page.locator(".task-details h2").isVisible(), commentVisible: await comment.isVisible() }, (value) => value.tabs === 0 && value.titleVisible && value.commentVisible);
    await comment.fill("Task inline comment draft.");
    await page.getByRole("button", { name: "Post comment", exact: true }).focus();
    expect(row, "task-comment-draft-kept-inline", await comment.inputValue(), (x) => x === "Task inline comment draft.");
    await shot(page, row, "comment-draft-preserved");
  });
  await pageCase("keyboard.request-detail-trap-restore-and-comment-draft", "keyboard", "desktop", async ({ row, fixture, page }) => {
    const portal = await fixture.context.newPage();
    await formBasics(portal, "Coverage request comment draft", false, row);
    await portal.getByRole("button", { name: "Send request", exact: true }).click();
    await portal.locator(".request-success").waitFor();

    await page.goto(W + "/requests", { waitUntil: "domcontentloaded" });
    await ready(page);
    const trigger = requestTrigger(page, "Coverage request comment draft");
    await trigger.click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    const focus = await settledFocusCycle(page);
    expect(row, "focus-inside-after-popup-settles", focus.afterPopupSettled300ms, Boolean);
    expect(row, "request-detail-focus-wraps-at-60ms", focus.after60ms, (x) => x.every(Boolean));
    expect(row, "request-detail-focus-wraps-at-300ms", focus.after300ms, (x) => x.every(Boolean));
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    const restore = await settledFocusRestore(page, trigger);
    expect(row, "request-detail-close-restores-trigger-at-60ms", restore.after60ms, Boolean);
    expect(row, "request-detail-close-restores-trigger-at-300ms", restore.after300ms, Boolean);

    await trigger.click();
    const requestDetail = page.getByRole("dialog");
    await requestDetail.waitFor();
    const comment = page.locator('textarea[id^="comment-"]');
    await comment.waitFor();
    expect(row, "request-comments-visible-with-detail-content", {
      titleVisible: await page.locator(".request-details h2").isVisible(),
      commentVisible: await comment.isVisible(),
    }, (value) => value.titleVisible && value.commentVisible);
    await comment.fill("Request inline comment draft.");
    expect(row, "request-comment-draft-kept-inline", await comment.inputValue(), (x) => x === "Request inline comment draft.");
    await shot(page, row, "request-comment-draft-inline");
  });
  await pageCase("keyboard.request-and-task-filter-drawers", "keyboard", "desktop", async ({ row, page }) => {
    await page.goto(W + "/requests", { waitUntil: "domcontentloaded" });
    await ready(page);
    expect(row, "plain-filter-buttons", await page.locator('[role="tablist"], [role="tab"]').count(), (n) => n === 0);
    const requestStatus = page.getByRole("group", { name: "Filter requests by status", exact: true });
    const approvedStatus = requestStatus.getByRole("button", { name: /^Approved · \d+$/ });
    await approvedStatus.click();
    expect(row, "request-status-button-updates-filtered-list", { pressed: await approvedStatus.getAttribute("aria-pressed"), label: await page.locator(".request-list").getAttribute("aria-label") }, (value) => value.pressed === "true" && value.label === "approved requests");
    const allStatuses = requestStatus.getByRole("button", { name: /^All requests · \d+$/ });
    await allStatuses.click();
    expect(row, "request-status-all-button-resets-filter", { pressed: await allStatuses.getAttribute("aria-pressed"), label: await page.locator(".request-list").getAttribute("aria-label") }, (value) => value.pressed === "true" && value.label === "all requests");

    // The workspace task-list route owns the task Filters drawer. A
    // department detail route exposes separate inline group/status controls.
    await page.goto(W + "/departments", { waitUntil: "domcontentloaded" });
    await ready(page);
    await page.getByRole("button", { name: /^Filters/ }).click();
    const taskFilterDrawer = page.getByRole("dialog", { name: "Filters" });
    const taskFilter = taskFilterDrawer.getByLabel("Filter tasks by status");
    await taskFilter.selectOption("completed");
    expect(row, "task-filter-select-is-a-real-control", await taskFilter.inputValue(), (value) => value === "completed");
    await taskFilterDrawer.getByRole("button", { name: "Reset filters", exact: true }).click();
    expect(row, "task-filter-reset-selects-all", await taskFilter.inputValue(), (value) => value === "all");
    await taskFilterDrawer.getByRole("button", { name: "Done", exact: true }).click();
    await shot(page, row);
  });
}

async function main() {
  await mkdir(OUT, { recursive: true });
  await mkdir(path.dirname(INVENTORY_OUT), { recursive: true });
  const sourceIdentity = JSON.parse(execFileSync(process.execPath, ["scripts/ui-review-hash.mjs"], { encoding: "utf8" }));
  result.candidate = { sourceSha256: sourceIdentity.sourceSha256, sourceFiles: sourceIdentity.sourceFiles };
  result.harness = { path: "scripts/check-ui-state-coverage.mjs", sha256: createHash("sha256").update(await readFile(new URL(import.meta.url))).digest("hex") };
  browser = await chromium.launch(
    process.env.PLAYWRIGHT_CHANNEL
      ? { channel: process.env.PLAYWRIGHT_CHANNEL }
      : {},
  );
  try {
    await errors();
    await accessAndEmpty();
    await mutations();
    await departmentManagementJourney();
    await catalogRoutingJourney();
    await memberManagementJourney();
    await portalBranches();
    await lifecycleCoverage();
    await denseContent();
    await keyboardAndErrors();
  } finally {
    await browser.close();
    const coverageJson = JSON.stringify(result, null, 2);
    await writeFile(path.join(OUT, "coverage.json"), coverageJson);
    const inventory = {
      schemaVersion: 1,
      generatedAt: result.generatedAt,
      scope: result.scope,
      candidate: result.candidate,
      harness: result.harness,
      selection: result.selection,
      isolatedApi: result.isolatedApi,
      stateCases: plannedStates.map((planned) => {
        const run = result.states.find((state) => state.stateId === planned.stateId);
        return run
          ? { ...planned, viewport: run.viewport, status: run.status, assertions: run.assertions, screenshots: run.screenshots, apiInjected: run.apiInjected, error: run.error }
          : { ...planned, status: planned.planned ? "not-run" : "not-run", reason: only ? `Excluded by --only=${only}.` : "Harness stopped before this case began." };
      }),
      retiredStates: [
        { stateId: "task.priority-controls-and-priority-data", disposition: "retired", reason: "Latest user scope removes priority from task data, API contracts, and UI." },
        { stateId: "workspace.global-task-search", disposition: "retired", reason: "Latest user scope removes the global TaskSearch surface." },
      ],
      openGaps: [
        { stateId: "auth.google-oauth-provider", surface: "workspace authentication", disposition: "not-driven", reason: "Requires a live identity provider and is outside the isolated browser fixture contract." },
        { stateId: "portal.native-date-picker-chrome", surface: "public request form", disposition: "not-driven", reason: "Native operating-system date picker internals vary by browser/OS; DOM validation and focus are exercised." },
        { stateId: "screen-reader-announcement-quality", surface: "all interactive surfaces", disposition: "not-driven", reason: "Automated rendered-state assertions do not replace assistive-technology evaluation." },
      ],
      summary: {
        verdict: result.failures.length ? "HARNESS_CASES_FAILED" : only ? "SELECTED_SUBSET_PASSED" : "ALL_FINITE_HARNESS_CASES_PASSED",
        cases: result.states.length,
        passed: result.states.filter((state) => state.status === "pass").length,
        failed: result.states.filter((state) => state.status === "fail").length,
        incomplete: result.states.filter((state) => state.status === "incomplete" || state.status === "running").length,
        notRun: plannedStates.filter((planned) => !result.states.some((state) => state.stateId === planned.stateId)).length,
        notImplemented: plannedStates.filter((planned) => planned.planned && !result.states.some((state) => state.stateId === planned.stateId)).length,
        failures: result.failures,
      },
    };
    await writeFile(INVENTORY_OUT, JSON.stringify(inventory, null, 2));
  }
  console.log("Coverage artifact: " + path.join(OUT, "coverage.json"));
  console.log("State inventory: " + INVENTORY_OUT);
  if (result.failures.length) {
    console.error("FAILED " + result.failures.length + ": " + result.failures.join(", "));
    process.exitCode = 1;
  } else if (only) console.log("HARNESS PASS selected subset only: " + result.states.length + " state cases in group '" + only + "'; other groups were not run");
  else console.log("HARNESS PASS " + result.states.length + " planned state cases; this is finite representative coverage, not broad product acceptance");
}

await main();
