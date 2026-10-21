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
    "mutation.task.progress.busy-error-recovery",
    "mutation.comments.post.busy-error-recovery",
    "mutation.request.approve.busy-error-recovery",
    "mutation.request.reject.busy-error-recovery",
  ].map((id) => [id, "mutations"]),
  ["mutation.portal-edit.busy-error-recovery", "mutations"],
  { stateId: "catalog.department-groups-ministry-service-remap-approve", group: "catalog", planned: true },
  { stateId: "departments.rename-group-create-delete-color", group: "departments", planned: true },
  { stateId: "tables.phone-members-departments-scrollcue-and-segmented-rects", group: "responsive", planned: true },
  { stateId: "members.invite-edit-duty-groups-leadership", group: "members", planned: true },
  ["portal.aired-date.validation-and-multiple", "portal"],
  ["empty.notifications-actions", "empty"],
  ["portal.tracking.pending-and-clipboard-denied", "portal"],
  ["portal.tracking.approved-progress-complete-rejected", "portal"],
  ["data.dense-long-dashboard-reports", "dense"],
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
  return !only || group.includes(only);
}
function inlineEditContainer(control) {
  return control.locator("xpath=../..");
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
}
async function ready(page) {
  await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(250);
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
  const after60ms = await page.evaluate((selector) => Boolean(document.activeElement?.matches(selector)), expectedSelector);
  await page.waitForTimeout(240);
  const after300ms = await page.evaluate((selector) => Boolean(document.activeElement?.matches(selector)), expectedSelector);
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
    ["/requests", "empty.requests", /All caught up/i],
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

async function createDepartmentAndGroups(page, name, firstGroup, secondGroup) {
  await page.goto(W + "/settings", { waitUntil: "domcontentloaded" });
  await ready(page);
  await page.getByRole("group", { name: "Settings section" }).getByRole("button", { name: "Departments", exact: true }).click();
  await page.getByRole("heading", { name: "Departments" }).waitFor();
  await page.getByRole("button", { name: "New department", exact: true }).click();
  const createDialog = page.getByRole("dialog", { name: "New department" });
  await createDialog.waitFor();
  await createDialog.getByLabel("Department name", { exact: true }).fill(name);
  await createDialog.getByLabel("First group", { exact: true }).fill(firstGroup);
  // The native select is explicitly associated through htmlFor/id. Resolve it
  // by its stable id: getByLabel is inconsistent here because the label also
  // renders the selected color text as part of its accessible-name subtree.
  await createDialog.locator("#new-department-color").selectOption("blue");
  await createDialog.getByRole("button", { name: "Create department", exact: true }).click();
  await createDialog.waitFor({ state: "detached" });
  const groupManager = page.getByRole("button", { name: new RegExp(`^Manage 1 groups? for ${name}$`) });
  await groupManager.waitFor();
  await groupManager.click();
  const groupsDrawer = page.getByRole("dialog", { name: `${name} groups` });
  await groupsDrawer.getByRole("button", { name: "Add group", exact: true }).click();
  const groupDialog = page.getByRole("dialog", { name: "Add group" });
  await groupDialog.getByLabel("Group name").fill(secondGroup);
  await groupDialog.getByRole("button", { name: "Save group", exact: true }).click();
  await groupDialog.waitFor({ state: "detached" });
  await groupsDrawer.getByRole("row", { name: new RegExp(secondGroup) }).waitFor();
  await groupsDrawer.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: `Manage 2 groups for ${name}`, exact: true }).waitFor();
  const state = await page.evaluate(async (api) => {
    const response = await fetch(api + "/api/workspace");
    if (!response.ok) throw new Error("Isolated workspace read failed: " + response.status);
    return response.json();
  }, API);
  const department = state.catalog.departments.find((item) => item.name === name);
  if (!department) throw new Error("Created department missing from persisted catalog: " + name);
  return department;
}

async function renameDepartmentGroup(page, department, oldName, nextName) {
  await page.goto(W + "/settings", { waitUntil: "domcontentloaded" });
  await ready(page);
  await page.getByRole("group", { name: "Settings section" }).getByRole("button", { name: "Departments", exact: true }).click();
  await page.getByRole("heading", { name: "Departments" }).waitFor();
  await page.getByRole("button", { name: `Manage 2 groups for ${department.name}`, exact: true }).click();
  await page.getByRole("button", { name: `Actions for ${oldName}`, exact: true }).click();
  await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Rename group" });
  await dialog.getByLabel("Group name").fill(nextName);
  await dialog.getByRole("button", { name: "Save group", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  await page.getByRole("row", { name: new RegExp(nextName) }).waitFor();
  await page.getByRole("dialog", { name: `${department.name} groups` })
    .getByRole("button", { name: "Close dialog" }).click();
  const state = await page.evaluate(async (api) => {
    const response = await fetch(api + "/api/workspace");
    if (!response.ok) throw new Error("Isolated workspace read failed: " + response.status);
    return response.json();
  }, API);
  const savedDepartment = state.catalog.departments.find((item) => item.id === department.id);
  const mappedServices = state.catalog.services.filter((item) => item.department === department.id);
  return {
    department: savedDepartment,
    oldNameStillPresent: Boolean(savedDepartment?.groups.includes(oldName)),
    mappedServices: mappedServices.map((item) => ({ name: item.name, group: item.subTeam })),
  };
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
    ["task.progress", "/departments/sound", async (page) => { await page.locator(".task-card-open").first().click(); await page.getByRole("button", { name: "100%", exact: true }).click(); return { busy: page.getByRole("button", { name: "100%", exact: true }), error: page.getByRole("alert"), retry: () => page.getByRole("button", { name: "100%", exact: true }).click() }; }],
    ["comments.post", "/departments/sound", async (page) => { await page.locator(".task-card-open").first().click(); await page.getByRole("button", { name: /^Comments/ }).click(); await page.getByRole("textbox", { name: "Add a comment" }).fill("Coverage comment retry."); await page.getByRole("button", { name: "Post comment" }).click(); return { busy: page.getByRole("button", { name: "Posting…" }), error: page.getByRole("alert"), retry: () => page.getByRole("button", { name: "Post comment" }).click() }; }],
    ["request.approve", "/requests", async (page) => { await page.locator(".request-row").first().click(); await page.getByRole("button", { name: "Approve and route" }).click(); return { busy: page.getByRole("button", { name: "Routing…" }), error: page.getByRole("alert"), retry: () => page.getByRole("button", { name: "Approve and route" }).click() }; }],
    ["request.reject", "/requests", async (page) => { await page.locator(".request-row").first().click(); await page.getByRole("button", { name: "Reject request" }).click(); await page.getByLabel("Reason for rejection").fill("Coverage rejection reason."); await page.getByRole("button", { name: "Return request" }).click(); return { busy: page.getByRole("button", { name: "Returning…" }), error: page.getByRole("alert"), retry: () => page.getByRole("button", { name: "Return request" }).click() }; }],
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
    const departmentRow = page.locator(".department-table tr").filter({ hasText: initialName });

    await departmentRow.getByRole("button", { name: `Actions for ${initialName}`, exact: true }).click();
    await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
    const nameDialog = page.getByRole("dialog", { name: "Rename department" });
    const nameInput = nameDialog.getByLabel("Department name");
    await nameInput.fill("Cancelled department draft");
    await nameDialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await nameDialog.waitFor({ state: "detached" });
    await page.getByRole("button", { name: `Actions for ${initialName}`, exact: true }).waitFor();
    expect(row, "department-rename-cancel-discards-draft", await page.locator(".department-table").innerText(), (text) => text.includes(initialName) && !text.includes("Cancelled department draft"));

    await page.getByRole("button", { name: `Actions for ${initialName}`, exact: true }).click();
    await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
    const duplicateNameDialog = page.getByRole("dialog", { name: "Rename department" });
    const duplicateNameInput = duplicateNameDialog.getByLabel("Department name");
    await duplicateNameInput.fill("Sound");
    await duplicateNameDialog.getByRole("button", { name: "Save name", exact: true }).click();
    const duplicateNameError = duplicateNameDialog.getByRole("alert");
    await duplicateNameError.waitFor();
    expect(row, "department-rename-duplicate-validation-retains-draft", { message: await duplicateNameError.innerText(), value: await duplicateNameInput.inputValue(), focus: await duplicateNameInput.evaluate((node) => document.activeElement === node) }, (state) => /already exists/i.test(state.message) && state.value === "Sound" && state.focus);

    const nextName = "Coverage Inline Department Renamed";
    await duplicateNameInput.fill(nextName);
    fixture.faults.set("POST /api/actions", { status: 503, remaining: 1, delay: 650, message: "coverage department rename failed" });
    await duplicateNameDialog.getByRole("button", { name: "Save name", exact: true }).click();
    await duplicateNameDialog.getByRole("button", { name: "Saving…", exact: true }).waitFor();
    await shot(page, row, "department-rename-busy");
    const renameError = duplicateNameDialog.getByRole("alert");
    await renameError.waitFor();
    await page.waitForTimeout(60);
    const focusDescription = () => duplicateNameInput.evaluate((node) => ({
      focused: document.activeElement === node,
      activeTag: document.activeElement?.tagName ?? null,
      activeId: document.activeElement?.id ?? null,
      activeLabel: document.activeElement?.getAttribute("aria-label") ?? null,
      activeText: document.activeElement?.textContent?.trim().slice(0, 40) ?? null,
    }));
    const renameErrorAt60ms = await focusDescription();
    await page.waitForTimeout(240);
    const renameErrorAt300ms = await focusDescription();
    expect(row, "department-rename-error-retains-draft", { message: await renameError.innerText(), value: await duplicateNameInput.inputValue(), focusAt60ms: renameErrorAt60ms, focusAt300ms: renameErrorAt300ms }, (state) => state.message.includes("coverage department rename failed") && state.value === nextName && state.focusAt300ms.focused);
    await shot(page, row, "department-rename-error-draft");
    await duplicateNameDialog.getByRole("button", { name: "Save name", exact: true }).click();
    await duplicateNameDialog.waitFor({ state: "detached" });
    await page.getByRole("button", { name: `Actions for ${nextName}`, exact: true }).waitFor();

    await page.getByRole("button", { name: `Manage 2 groups for ${nextName}`, exact: true }).click();
    const groupsDrawer = page.getByRole("dialog", { name: `${nextName} groups` });
    await groupsDrawer.getByRole("button", { name: "Add group", exact: true }).click();
    const addGroupDialog = page.getByRole("dialog", { name: "Add group" });
    const groupInput = addGroupDialog.getByLabel("Group name");
    await groupInput.fill(first);
    await addGroupDialog.getByRole("button", { name: "Save group", exact: true }).click();
    const groupValidation = addGroupDialog.getByRole("alert");
    await groupValidation.waitFor();
    expect(row, "group-create-duplicate-validation-keeps-draft", { message: await groupValidation.innerText(), value: await groupInput.inputValue(), focus: await groupInput.evaluate((node) => document.activeElement === node) }, (state) => /already exists/i.test(state.message) && state.value === first && state.focus);
    const third = "Inline Gamma";
    await groupInput.fill(third);
    fixture.faults.set("POST /api/actions", { status: 503, remaining: 1, delay: 650, message: "coverage group create failed" });
    await addGroupDialog.getByRole("button", { name: "Save group", exact: true }).click();
    const groupSaveError = addGroupDialog.getByRole("alert");
    await groupSaveError.waitFor();
    expect(row, "group-create-error-retains-draft-for-retry", { message: await groupSaveError.innerText(), value: await groupInput.inputValue() }, (state) => state.message.includes("coverage group create failed") && state.value === third);
    await shot(page, row, "group-create-error-draft");
    await addGroupDialog.getByRole("button", { name: "Save group", exact: true }).click();
    await addGroupDialog.waitFor({ state: "detached" });
    await groupsDrawer.getByRole("row", { name: new RegExp(third) }).waitFor();

    await groupsDrawer.getByRole("button", { name: `Actions for ${third}`, exact: true }).click();
    await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
    const deleteDialog = page.getByRole("dialog", { name: "Delete group?" });
    expect(row, "group-delete-confirmation-names-target", await deleteDialog.innerText(), (text) => text.includes(third) && text.includes("must be reassigned first"));
    await deleteDialog.getByRole("button", { name: "Delete group", exact: true }).click();
    await page.getByRole("row", { name: new RegExp(third) }).waitFor({ state: "detached" });
    await shot(page, row, "group-create-and-delete-recovered");
    await groupsDrawer.getByRole("button", { name: "Close dialog" }).click();

    const colorLabel = `Edit ${nextName} calendar color`;
    await page.getByRole("button", { name: colorLabel, exact: true }).click();
    const colorSelect = page.getByLabel(`${nextName} calendar color`, { exact: true });
    await colorSelect.waitFor();
    await colorSelect.selectOption("teal");
    fixture.faults.set("POST /api/actions", { status: 503, remaining: 1, delay: 650, message: "coverage department color failed" });
    await page.getByRole("button", { name: `Save ${nextName} calendar color`, exact: true }).click();
    const colorError = departmentRow.getByRole("alert");
    await colorError.waitFor();
    expect(row, "department-color-error-retains-draft", { message: await colorError.innerText(), value: await colorSelect.inputValue() }, (state) => state.message.includes("coverage department color failed") && state.value === "teal");
    await page.getByRole("button", { name: `Save ${nextName} calendar color`, exact: true }).click();
    await page.getByRole("button", { name: colorLabel, exact: true }).waitFor();
    const persisted = await page.evaluate(async ({ api, id }) => {
      const response = await fetch(api + "/api/workspace");
      const state = await response.json();
      const item = state.catalog.departments.find((candidate) => candidate.id === id);
      return item && { name: item.name, groups: item.groups, color: item.color };
    }, { api: API, id: department.id });
    expect(row, "department-groups-and-color-persisted", persisted, (value) => value.name === nextName && value.groups.includes(first) && value.groups.includes(second) && !value.groups.includes(third) && value.color === "teal");
    expect(row, "department-actions-failures-injected-through-disposable-api", fixture.injected.filter((item) => item.key === "POST /api/actions" && item.status === 503).length === 3, Boolean);
    await shot(page, row, "department-final");
  });

  await pageCase("tables.phone-members-departments-scrollcue-and-segmented-rects", "responsive", "narrow", async ({ row, page }) => {
    await page.goto(W + "/settings", { waitUntil: "domcontentloaded" });
    await ready(page);
    const settingsSection = page.getByRole("group", { name: "Settings section" });
    const settingsButtons = settingsSection.getByRole("button");
    const segmentRects = await settingsButtons.evaluateAll((items) => items.map((node) => { const r = node.getBoundingClientRect(); return { label: node.textContent?.trim(), selected: node.getAttribute("aria-pressed"), x: r.x, y: r.y, width: r.width, height: r.height }; }));
    expect(row, "settings-section-uses-rectangular-pressed-buttons", segmentRects, (items) => items.length === 2 && items.every((item) => item.width >= 36 && item.height >= 32 && item.x >= 0 && item.x + item.width <= 320) && items[0].selected === "true");
    await settingsSection.getByRole("button", { name: "Departments", exact: true }).click();
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
    const updatedSegments = await settingsButtons.evaluateAll((items) => items.map((node) => ({ label: node.textContent?.trim(), selected: node.getAttribute("aria-pressed"), rect: (() => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })() })));
    expect(row, "settings-navigation-interaction-updates-pressed-state", updatedSegments, (items) => items[0].selected === "false" && items[1].selected === "true");
    const membersButton = settingsSection.getByRole("button", { name: "Members", exact: true });
    await membersButton.click();
    const memberRegion = page.getByRole("region", { name: "Members table; scroll horizontally to see all columns" });
    await memberRegion.waitFor();
    const memberGeometry = await memberRegion.evaluate((node) => ({ clientWidth: node.clientWidth, scrollWidth: node.scrollWidth, tableWidth: node.querySelector("table")?.getBoundingClientRect().width ?? 0, focusable: node.tabIndex >= 0, cue: document.body.innerText.includes("Scroll horizontally to see all member fields") }));
    expect(row, "phone-members-table-scroll-cue-and-region", memberGeometry, (value) => value.clientWidth > 0 && value.scrollWidth > value.clientWidth && value.tableWidth >= value.scrollWidth - 2 && value.focusable && value.cue);
    expect(row, "segmented-options-have-valid-phone-rectangles", updatedSegments, (items) => items.every((item) => item.rect.x >= 0 && item.rect.width >= 36 && item.rect.height >= 32 && item.rect.x + item.rect.width <= 320));
    await memberRegion.focus();
    const keyboardAccessible = await memberRegion.evaluate((node) => ({ focused: document.activeElement === node, tabIndex: node.tabIndex, scrollLeft: node.scrollLeft }));
    expect(row, "table-region-keyboard-focusable-scroll-cue-target", keyboardAccessible, (value) => value.focused && value.tabIndex >= 0 && Number.isFinite(value.scrollLeft));
    await page.getByRole("button", { name: "Open navigation" }).click();
    const mobileNav = page.locator('nav[aria-label="All workspace pages"] .nav-item');
    await mobileNav.first().waitFor();
    const nav = await mobileNav.evaluateAll((items) => items.map((node) => { const r = node.getBoundingClientRect(); return { label: node.textContent?.trim(), x: r.x, y: r.y, width: r.width, height: r.height }; }));
    expect(row, "mobile-navigation-links-have-visible-in-viewport-rectangles", nav, (items) => items.length >= 4 && items.every((item) => item.x >= 0 && item.y >= 0 && item.width >= 32 && item.height >= 32 && item.x + item.width <= 320 && item.y + item.height <= 844));
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

    await page.goto(W + "/requests", { waitUntil: "domcontentloaded" });
    await ready(page);
    await page.getByRole("button", { name: "Request options", exact: true }).click();
    const catalogDialog = page.getByRole("dialog");
    await catalogDialog.waitFor();
    await shot(page, row, "catalog-options-open");
    await catalogDialog.getByRole("button", { name: "Ministries", exact: true }).click();
    await catalogDialog.getByRole("heading", { name: "Ministries", exact: true }).waitFor();
    await shot(page, row, "catalog-ministry-tab");
    await catalogDialog.getByRole("button", { name: "New ministry", exact: true }).click();
    await catalogDialog.getByLabel("New ministry name").fill(ministryName);
    await catalogDialog.locator(".request-catalog-create-row").getByRole("button", { name: "Save", exact: true }).click();
    await catalogDialog.locator(".request-catalog-create-row").waitFor({ state: "detached" });
    await catalogDialog.getByText(ministryName, { exact: true }).waitFor();
    await shot(page, row, "catalog-ministry-created");
    const ministryReadLabel = `Edit ${ministryName} ministry name`;
    const ministryReadButton = catalogDialog.getByRole("button", { name: ministryReadLabel, exact: true });
    await ministryReadButton.waitFor({ state: "visible" });
    await page.waitForFunction((label) => Array.from(document.querySelectorAll("button")).some((button) => button.getAttribute("aria-label") === label && !button.disabled), ministryReadLabel);
    await ministryReadButton.click();
    const ministryEditor = catalogDialog.getByLabel(`Ministry name for ${ministryName}`);
    await ministryEditor.fill("Discarded ministry draft");
    await ministryEditor.press("Escape");
    expect(row, "escape-cancels-ministry-cell-without-closing-parent", await catalogDialog.isVisible(), Boolean);
    await catalogDialog.getByRole("button", { name: ministryReadLabel, exact: true }).waitFor();
    await catalogDialog.getByRole("button", { name: ministryReadLabel, exact: true }).click();
    const renamedMinistry = `${ministryName} Updated`;
    await catalogDialog.getByLabel(`Ministry name for ${ministryName}`).fill(renamedMinistry);
    await catalogDialog.getByRole("button", { name: `Save ${ministryName} ministry name`, exact: true }).click();
    await catalogDialog.getByRole("button", { name: `Edit ${renamedMinistry} ministry name`, exact: true }).waitFor();
    ministryName = renamedMinistry;
    await catalogDialog.getByRole("button", { name: "Services", exact: true }).click();
    await catalogDialog.getByRole("button", { name: "New service", exact: true }).click();
    const serviceRow = catalogDialog.locator(".request-catalog-create-row");
    await serviceRow.waitFor();
    await catalogDialog.getByLabel("New service name").fill(serviceName);
    await catalogDialog.getByLabel("New service department").selectOption(department.id);
    await catalogDialog.getByLabel("New service group").selectOption({ label: firstGroup });
    await serviceRow.getByRole("button", { name: "Save", exact: true }).click();
    await serviceRow.waitFor({ state: "detached" });
    await catalogDialog.getByText(serviceName, { exact: true }).waitFor();
    const serviceNameReadLabel = `Edit ${serviceName} service name`;
    await catalogDialog.getByRole("button", { name: serviceNameReadLabel, exact: true }).click();
    const serviceNameEditor = catalogDialog.getByLabel(`Service name for ${serviceName}`);
    await serviceNameEditor.fill("Discarded service draft");
    await serviceNameEditor.press("Escape");
    await catalogDialog.getByRole("button", { name: serviceNameReadLabel, exact: true }).waitFor();
    await catalogDialog.getByRole("button", { name: serviceNameReadLabel, exact: true }).click();
    const renamedService = `${serviceName} Updated`;
    await catalogDialog.getByLabel(`Service name for ${serviceName}`).fill(renamedService);
    await catalogDialog.getByLabel(`Service name for ${serviceName}`).press("Enter");
    await catalogDialog.getByRole("button", { name: `Edit ${renamedService} service name`, exact: true }).waitFor();
    serviceName = renamedService;
    const airedRequirementLabel = `Edit ${serviceName} aired-date requirement`;
    await catalogDialog.getByRole("button", { name: airedRequirementLabel, exact: true }).click();
    const requiresDates = catalogDialog.getByRole("checkbox", { name: `Requires aired dates for ${serviceName}` });
    await requiresDates.check();
    await catalogDialog.getByRole("button", { name: `Save ${serviceName} aired-date requirement`, exact: true }).click();
    await catalogDialog.getByRole("button", { name: airedRequirementLabel, exact: true }).waitFor();
    const serviceGroupLabel = `Edit ${serviceName} group`;
    await catalogDialog.getByRole("button", { name: serviceGroupLabel, exact: true }).click();
    const serviceGroup = catalogDialog.getByLabel(`Group for ${serviceName}`);
    await serviceGroup.selectOption({ label: secondGroup });
    await serviceGroup.press("Escape");
    expect(row, "escape-cancels-service-group-cell-without-closing-parent", await catalogDialog.isVisible(), Boolean);
    await catalogDialog.getByRole("button", { name: serviceGroupLabel, exact: true }).waitFor();
    expect(row, "catalog-created-in-visible-list", await catalogDialog.innerText(), (text) => text.includes(ministryName) || text.includes(serviceName));
    await shot(page, row, "catalog-created");
    await catalogDialog.getByRole("button", { name: "Close dialog" }).click();

    const renamedGroup = "Studio Alpha Renamed";
    const rename = await renameDepartmentGroup(page, department, firstGroup, renamedGroup);
    expect(row, "group-rename-updates-service-mapping-atomically", rename, (saved) => saved.department?.groups.includes(renamedGroup) && !saved.oldNameStillPresent && saved.mappedServices.some((item) => item.name === serviceName && item.group === renamedGroup));
    await shot(page, row, "group-renamed-service-mapping-updated");

    await page.getByRole("button", { name: `Manage 2 groups for ${department.name}`, exact: true }).click();
    const groupsDrawer = page.getByRole("dialog", { name: `${department.name} groups` });
    await groupsDrawer.getByRole("button", { name: `Actions for ${renamedGroup}`, exact: true }).click();
    await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
    const blockedDelete = page.getByRole("dialog", { name: "Delete group?" });
    expect(row, "in-use-group-delete-confirmation-explains-reassignment", await blockedDelete.innerText(), (text) => text.includes(renamedGroup) && /reassigned first/i.test(text));
    await blockedDelete.getByRole("button", { name: "Delete group", exact: true }).click();
    const blockedError = blockedDelete.getByRole("alert");
    await blockedError.waitFor();
    expect(row, "in-use-group-delete-rejected-and-retained", { error: await blockedError.innerText(), rowCount: await page.locator(".modal-panel table tr").filter({ hasText: renamedGroup }).count() }, (value) => Boolean(value.error) && value.rowCount === 1);
    await shot(page, row, "in-use-group-delete-blocked");
    await blockedDelete.getByRole("button", { name: "Cancel", exact: true }).click();
    await blockedDelete.waitFor({ state: "detached" });
    await groupsDrawer.getByRole("button", { name: "Close dialog" }).click();
    await groupsDrawer.waitFor({ state: "detached" });

    const portal = await fixture.context.newPage();
    await formBasics(portal, requestTitle, true, row, new RegExp("^" + serviceName + "$"), ministryName);
    await shot(portal, row, "public-request-review");
    await portal.getByRole("button", { name: "Send request", exact: true }).click();
    await portal.locator(".request-success").waitFor();
    expect(row, "public-request-receipt", await portal.locator(".request-success").innerText(), (text) => text.includes("We’ve got it.") && text.includes("Your access code"));
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
    await page.getByRole("button", { name: "Request options", exact: true }).click();
    const remapDialog = page.getByRole("dialog");
    await remapDialog.getByRole("button", { name: `Edit ${serviceName} group`, exact: true }).click();
    await remapDialog.getByLabel(`Group for ${serviceName}`).selectOption({ label: secondGroup });
    await remapDialog.getByRole("button", { name: `Save ${serviceName} group`, exact: true }).click();
    await remapDialog.getByRole("button", { name: `Edit ${serviceName} group`, exact: true }).waitFor();
    const stateAfterRemap = await page.evaluate(async (api) => {
      const response = await fetch(api + "/api/workspace");
      if (!response.ok) throw new Error("Isolated workspace read failed: " + response.status);
      return response.json();
    }, API);
    const savedService = stateAfterRemap.catalog.services.find((item) => item.name === serviceName);
    expect(row, "saved-service-remapped-before-approval", savedService && { department: savedService.department, group: savedService.subTeam }, (mapping) => mapping.department === department.id && mapping.group === secondGroup);
    await shot(page, row, "service-remapped");
    await remapDialog.getByRole("button", { name: "Close dialog" }).click();

    const pending = page.locator(".request-row").filter({ hasText: requestTitle });
    await pending.waitFor();
    await pending.click();
    const detail = page.getByRole("dialog");
    await detail.getByRole("button", { name: "Approve and route", exact: true }).click();
    await detail.waitFor({ state: "detached" });
    await page.goto(W + "/departments/" + department.id, { waitUntil: "domcontentloaded" });
    await ready(page);
    const card = page.locator(".task-card").filter({ hasText: requestTitle });
    await card.waitFor();
    expect(row, "approved-task-routed-to-remapped-department-group", await card.innerText(), (text) => text.includes(secondGroup) && text.includes(ministryName));
    const finalState = await page.evaluate(async (api) => {
      const response = await fetch(api + "/api/workspace");
      if (!response.ok) throw new Error("Isolated workspace read failed: " + response.status);
      return response.json();
    }, API);
    const routed = finalState.tasks.filter((task) => task.title === requestTitle);
    expect(row, "exactly-one-auto-routed-task", routed.map(({ department: routedDepartment, subTeam }) => ({ department: routedDepartment, subTeam })), (tasks) => tasks.length === 1 && tasks[0].department === department.id && tasks[0].subTeam === secondGroup);
    await shot(page, row, "approved-auto-routed");
  });
}

async function memberManagementJourney() {
  await pageCase("members.invite-edit-duty-groups-leadership", "members", "desktop", async ({ row, fixture, page }) => {
    let memberName = "Coverage Invited Member";
    const email = "coverage-invited@example.org";
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

    const memberRow = page.locator(".members-row").filter({ hasText: email });
    await memberRow.waitFor();
    const nameLabel = `Edit ${memberName} name`;
    await memberRow.getByRole("button", { name: nameLabel, exact: true }).click();
    const memberNameEditor = memberRow.getByLabel(`Name for ${memberName}`);
    await memberNameEditor.fill("Discarded name draft");
    await memberNameEditor.press("Escape");
    await memberRow.getByRole("button", { name: nameLabel, exact: true }).waitFor();
    await memberRow.getByRole("button", { name: nameLabel, exact: true }).click();
    const renamedMember = `${memberName} Updated`;
    await memberRow.getByLabel(`Name for ${memberName}`).fill(renamedMember);
    await memberRow.getByLabel(`Name for ${memberName}`).press("Enter");
    await memberRow.getByRole("button", { name: `Edit ${renamedMember} name`, exact: true }).waitFor();
    memberName = renamedMember;
    const dutyLabel = `Edit ${memberName} duty`;
    await memberRow.getByRole("button", { name: dutyLabel, exact: true }).click();
    const duty = memberRow.getByLabel(`Duty for ${memberName}`);
    await duty.waitFor();
    await duty.fill("Discarded inline duty");
    await duty.press("Escape");
    await memberRow.getByRole("button", { name: dutyLabel, exact: true }).waitFor();
    await page.waitForTimeout(60);
    const escapeFocus60 = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
    await page.waitForTimeout(300);
    const escapeFocus300 = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
    expect(row, "member-duty-escape-focus-at-60ms", escapeFocus60, (label) => label === dutyLabel);
    expect(row, "member-duty-escape-focus-stable-at-300ms", escapeFocus300, (label) => label === dutyLabel);

    await memberRow.getByRole("button", { name: dutyLabel, exact: true }).click();
    await duty.fill("Production lead");
    fixture.faults.set("POST /api/actions", { status: 503, remaining: 1, delay: 650, message: "coverage member duty failed" });
    await memberRow.getByRole("button", { name: `Save ${memberName} duty`, exact: true }).click();
    const dutyEditor = inlineEditContainer(duty);
    await dutyEditor.waitFor();
    expect(row, "member-duty-editor-busy", await dutyEditor.getAttribute("aria-busy"), (value) => value === "true");
    expect(row, "member-duty-save-cancel-disabled-while-saving", await memberRow.getByRole("button", { name: `Save ${memberName} duty`, exact: true }).isDisabled() && await memberRow.getByRole("button", { name: `Cancel editing ${memberName} duty`, exact: true }).isDisabled(), Boolean);
    await shot(page, row, "duty-busy");
    const dutyError = dutyEditor.getByRole("alert");
    await dutyError.waitFor();
    expect(row, "member-duty-error-preserves-retry-draft", { error: await dutyError.innerText(), value: await duty.inputValue() }, (value) => value.error.includes("coverage member duty failed") && value.value === "Production lead");
    await shot(page, row, "duty-error-draft");
    await memberRow.getByRole("button", { name: `Save ${memberName} duty`, exact: true }).click();
    await memberRow.getByRole("button", { name: dutyLabel, exact: true }).waitFor();
    await page.waitForTimeout(60);
    const saveFocus60 = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
    await page.waitForTimeout(300);
    const saveFocus300 = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
    expect(row, "member-duty-save-focus-at-60ms", saveFocus60, (label) => label === dutyLabel);
    expect(row, "member-duty-save-focus-stable-at-300ms", saveFocus300, (label) => label === dutyLabel);

    const departmentLabel = `Edit ${memberName} department`;
    await memberRow.getByRole("button", { name: departmentLabel, exact: true }).click();
    const departmentSelect = memberRow.getByLabel(`Department for ${memberName}`);
    await departmentSelect.waitFor();
    await departmentSelect.selectOption(department.id);
    expect(row, "member-department-previews-atomic-group-assignment", await memberRow.locator(".members-department-group-preview").innerText(), (text) => text.includes("Groups will be set to Member Alpha"));
    fixture.faults.set("POST /api/actions", { status: 503, remaining: 1, delay: 650, message: "coverage member department failed" });
    await memberRow.getByRole("button", { name: `Save ${memberName} department`, exact: true }).click();
    const departmentError = inlineEditContainer(departmentSelect).getByRole("alert");
    await departmentError.waitFor();
    expect(row, "member-department-error-preserves-selection", { error: await departmentError.innerText(), value: await departmentSelect.inputValue() }, (value) => value.error.includes("coverage member department failed") && value.value === department.id);
    await shot(page, row, "department-error-draft");
    await memberRow.getByRole("button", { name: `Save ${memberName} department`, exact: true }).click();
    await memberRow.getByRole("button", { name: departmentLabel, exact: true }).waitFor();

    const groupsLabel = `Edit ${memberName} groups`;
    await memberRow.getByRole("button", { name: groupsLabel, exact: true }).click();
    const groups = memberRow.getByRole("group", { name: `Groups for ${memberName}` });
    await groups.waitFor();
    const alpha = groups.getByRole("checkbox", { name: "Member Alpha", exact: true });
    const beta = groups.getByRole("checkbox", { name: "Member Beta", exact: true });
    await alpha.uncheck();
    await memberRow.getByRole("button", { name: `Save ${memberName} groups`, exact: true }).click();
    const emptyGroupsError = inlineEditContainer(groups).getByRole("alert");
    await emptyGroupsError.waitFor();
    expect(row, "member-groups-require-at-least-one-selection", { error: await emptyGroupsError.innerText(), selected: await groups.getByRole("checkbox").evaluateAll((nodes) => nodes.filter((node) => node.checked).length) }, (value) => value.error.includes("Choose at least one group") && value.selected === 0);
    await alpha.check();
    await beta.check();
    await beta.press("Escape");
    await memberRow.getByRole("button", { name: groupsLabel, exact: true }).waitFor();
    expect(row, "member-groups-escape-discards-draft", await memberRow.innerText(), (text) => text.includes("Member Alpha") && !text.includes("Member Beta"));

    await memberRow.getByRole("button", { name: groupsLabel, exact: true }).click();
    const groupsRetry = memberRow.getByRole("group", { name: `Groups for ${memberName}` });
    await groupsRetry.getByRole("checkbox", { name: "Member Alpha", exact: true }).uncheck();
    await groupsRetry.getByRole("checkbox", { name: "Member Beta", exact: true }).check();
    fixture.faults.set("POST /api/actions", { status: 503, remaining: 1, delay: 650, message: "coverage member groups failed" });
    await memberRow.getByRole("button", { name: `Save ${memberName} groups`, exact: true }).click();
    const groupsError = inlineEditContainer(groupsRetry).getByRole("alert");
    await groupsError.waitFor();
    expect(row, "member-groups-error-preserves-checkbox-draft", { error: await groupsError.innerText(), alpha: await groupsRetry.getByRole("checkbox", { name: "Member Alpha", exact: true }).isChecked(), beta: await groupsRetry.getByRole("checkbox", { name: "Member Beta", exact: true }).isChecked() }, (value) => value.error.includes("coverage member groups failed") && !value.alpha && value.beta);
    await shot(page, row, "groups-error-draft");
    await memberRow.getByRole("button", { name: `Save ${memberName} groups`, exact: true }).click();
    await memberRow.getByRole("button", { name: groupsLabel, exact: true }).waitFor();

    const leaderSwitch = memberRow.getByRole("switch", { name: memberName + " leader role" });
    expect(row, "member-duty-department-and-groups-updated", await memberRow.innerText(), (text) => text.includes("Production lead") && text.includes(departmentName) && text.includes("Member Beta") && !text.includes("Member Alpha"));
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
    const saved = finalState.users.find((member) => member.email === email);
    expect(row, "member-contract-persisted", saved && { name: saved.name, duty: saved.duty, department: saved.department, groups: saved.groups, isLeader: saved.isLeader, approved: saved.approved }, (member) => member.name === memberName && member.duty === "Production lead" && member.department === department.id && member.groups.length === 1 && member.groups[0] === "Member Beta" && !member.isLeader && member.approved);
    expect(row, "three-inline-member-save-failures-were-injected", fixture.injected.filter((item) => item.key === "POST /api/actions" && item.status === 503).length >= 4, Boolean);
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
    await shot(page, row, "pending");
  });
  await pageCase("portal.tracking.approved-progress-complete-rejected", "portal", "desktop", async ({ row, fixture }) => {
    const portal = await fixture.context.newPage();
    await formBasics(portal, "coverage terminal status approved", false, row, /Video creation/i);
    await portal.getByRole("button", { name: "Send request", exact: true }).click();
    await portal.locator(".request-success").waitFor();
    const approvedCode = (await portal.locator(".access-code").innerText()).trim();
    const workspace = await fixture.context.newPage();
    await workspace.goto(W, { waitUntil: "domcontentloaded" });
    await ready(workspace);
    await workspace.goto(W + "/requests", { waitUntil: "domcontentloaded" });
    await workspace.locator(".request-row").filter({ hasText: "coverage terminal status approved" }).click();
    await workspace.getByRole("button", { name: "Approve and route" }).click();
    await workspace.getByRole("heading", { name: "Requests" }).waitFor();
    await portal.goto(P, { waitUntil: "domcontentloaded" });
    await portal.getByRole("button", { name: /Track a submission/i }).click();
    await portal.getByLabel("Private access code").fill(approvedCode);
    await portal.getByRole("button", { name: "Search", exact: true }).click();
    await portal.locator(".tracking-summary").waitFor();
    expect(row, "approved-not-started-branch", await portal.locator(".tracking-summary").innerText(), (x) => /Approved/.test(x) && /0% complete/.test(x));
    await shot(portal, row, "approved");
    await workspace.goto(W + "/departments/visual-media", { waitUntil: "domcontentloaded" });
    await workspace.locator(".task-card-open").filter({ hasText: "coverage terminal status approved" }).click();
    await workspace.getByRole("button", { name: "25%", exact: true }).click();
    await workspace.getByRole("heading", { name: "Visual Media" }).waitFor();
    await portal.getByLabel("Private access code").fill(approvedCode);
    await portal.getByRole("button", { name: "Search", exact: true }).click();
    await portal.locator(".tracking-summary").waitFor();
    expect(row, "approved-in-progress-branch", await portal.locator(".tracking-summary").innerText(), (x) => /In progress/.test(x) && /25%/.test(x));
    await shot(portal, row, "in-progress");
    await workspace.locator(".task-card-open").filter({ hasText: "coverage terminal status approved" }).click();
    await workspace.getByRole("button", { name: "100%", exact: true }).click();
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
    await workspace.locator(".request-row").filter({ hasText: "coverage terminal status rejected" }).click();
    await workspace.getByRole("button", { name: "Reject request" }).click();
    await workspace.getByLabel("Reason for rejection").fill("Please clarify the requested delivery format.");
    await workspace.getByRole("button", { name: "Return request" }).click();
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

async function denseContent() {
  await pageCase("data.dense-long-dashboard-reports", "dense", "narrow", async ({ row, fixture, page }) => {
    await fixture.context.route(API + "/api/workspace", async (route) => {
      const response = await route.fetch({ url: fixture.api.url + "/api/workspace" });
      const data = await response.json();
      const base = data.tasks[0];
      if (!base) throw new Error("Seed task required for a realistic dense fixture");
      const longTitle = "Very long ministry production task title used to verify wrapping and narrow screen access";
      data.tasks = Array.from({ length: 80 }, (_, i) => ({
        ...base,
        id: "coverage-dense-" + i,
        title: longTitle + " " + i,
        status: i % 4 === 0 ? "completed" : "in-progress",
        progress: i % 4 === 0 ? 100 : 50,
        dueAt: new Date(Date.now() + i * 3600000).toISOString(),
        completedAt: i % 4 === 0 ? new Date().toISOString() : undefined,
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
        progress: i % 3 === 0 ? 100 : i % 3 === 1 ? 50 : 0,
        completedAt: i % 3 === 0 ? new Date(day.getTime()).toISOString() : undefined,
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
    await page.getByRole("button", { name: /^Comments/ }).click();
    const comment = page.locator('textarea[id^="comment-"]');
    await comment.waitFor();
    await comment.fill("Draft survives switching detail tabs.");
    await page.getByRole("button", { name: "Overview" }).click();
    expect(row, "draft-kept-while-comments-hidden", await comment.inputValue(), (x) => x === "Draft survives switching detail tabs.");
    await page.getByRole("button", { name: /^Comments/ }).click();
    expect(row, "draft-restored-on-comments-tab", await comment.inputValue(), (x) => x === "Draft survives switching detail tabs.");
    await shot(page, row, "comment-draft-preserved");
  });
  await pageCase("keyboard.request-detail-trap-restore-and-comment-draft", "keyboard", "desktop", async ({ row, fixture, page }) => {
    const portal = await fixture.context.newPage();
    await formBasics(portal, "Coverage request comment draft", false, row);
    await portal.getByRole("button", { name: "Send request", exact: true }).click();
    await portal.locator(".request-success").waitFor();

    await page.goto(W + "/requests", { waitUntil: "domcontentloaded" });
    await ready(page);
    const trigger = page.locator(".request-row").filter({ hasText: "Coverage request comment draft" });
    await trigger.click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    const focus = await settledFocusCycle(page);
    expect(row, "focus-inside-after-popup-settles", focus.afterPopupSettled300ms, Boolean);
    expect(row, "request-detail-focus-wraps-at-60ms", focus.after60ms, (x) => x.every(Boolean));
    expect(row, "request-detail-focus-wraps-at-300ms", focus.after300ms, (x) => x.every(Boolean));
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    const restore = await settledFocusRestore(page, ".request-row");
    expect(row, "request-detail-close-restores-trigger-at-60ms", restore.after60ms, Boolean);
    expect(row, "request-detail-close-restores-trigger-at-300ms", restore.after300ms, Boolean);

    await trigger.click();
    await page.getByRole("dialog").waitFor();
    await page.getByRole("button", { name: /^Comments/ }).click();
    const comment = page.locator('textarea[id^="comment-"]');
    await comment.waitFor();
    await comment.fill("Request draft survives switching detail tabs.");
    await page.getByRole("button", { name: "Overview" }).click();
    expect(row, "request-draft-kept-while-hidden", await comment.inputValue(), (x) => x === "Request draft survives switching detail tabs.");
    await page.getByRole("button", { name: /^Comments/ }).click();
    expect(row, "request-draft-restored-on-comments-tab", await comment.inputValue(), (x) => x === "Request draft survives switching detail tabs.");
    await shot(page, row, "request-comment-draft-preserved");
  });
  await pageCase("keyboard.request-and-task-filter-drawers", "keyboard", "desktop", async ({ row, page }) => {
    await page.goto(W + "/requests", { waitUntil: "domcontentloaded" });
    await ready(page);
    expect(row, "plain-filter-buttons", await page.locator('[role="tablist"], [role="tab"]').count(), (n) => n === 0);
    await page.getByRole("button", { name: /^Filters/ }).click();
    const requestFilterDrawer = page.getByRole("dialog", { name: "Filters" });
    const requestFilter = requestFilterDrawer.getByLabel("Filter requests by status");
    await requestFilter.selectOption("approved");
    expect(row, "request-filter-select-updates-filtered-list", { value: await requestFilter.inputValue(), label: await page.locator(".request-list").getAttribute("aria-label") }, (value) => value.value === "approved" && value.label === "approved requests");
    await requestFilterDrawer.getByRole("button", { name: "Reset filters", exact: true }).click();
    expect(row, "request-filter-reset-selects-all", { value: await requestFilter.inputValue(), label: await page.locator(".request-list").getAttribute("aria-label") }, (value) => value.value === "all" && value.label === "all requests");
    await requestFilterDrawer.getByRole("button", { name: "Done", exact: true }).click();
    await requestFilterDrawer.waitFor({ state: "detached" });

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
  browser = await chromium.launch();
  try {
    await errors();
    await accessAndEmpty();
    await mutations();
    await departmentManagementJourney();
    await catalogRoutingJourney();
    await memberManagementJourney();
    await portalBranches();
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
