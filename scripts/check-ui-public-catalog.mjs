#!/usr/bin/env node
/** Public-request catalog journeys against a throwaway API, never the live demo. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { startUiTestApi } from "./ui-test-server.mjs";

const W = process.env.WORKSPACE_URL || "http://localhost:5173";
const P = process.env.PORTAL_URL || "http://localhost:5174";
const API = process.env.API_URL || "http://localhost:3001";
const OUT = path.resolve(process.env.UI_PUBLIC_CATALOG_OUT || "output/reviews/public-catalog");
const only = process.argv.find((arg) => arg.startsWith("--only="))?.slice(7);
const report = { generatedAt: new Date().toISOString(), isolatedApi: true, cases: [] };
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || "chrome" });

async function run(name, width, body) {
  if (only && !name.includes(only)) return;
  const row = { name, width, status: "running", assertions: [], screenshots: [], error: null };
  report.cases.push(row);
  const api = await startUiTestApi([new URL(W).origin, new URL(P).origin]);
  const context = await browser.newContext({ viewport: { width, height: 960 }, hasTouch: width <= 390, timezoneId: "Africa/Johannesburg", reducedMotion: "reduce" });
  const errors = [];
  let failAction = false;
  context.on("page", (page) => {
    page.setDefaultTimeout(12000);
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error" && !/Failed to load resource:.*(?:400|403|503)/.test(message.text())) errors.push(message.text());
    });
  });
  await context.route(API + "/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (failAction && request.method() === "POST" && url.pathname === "/api/actions") {
      failAction = false;
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Catalog fixture temporarily unavailable." }) });
      return;
    }
    try {
      const response = await route.fetch({ url: api.url + url.pathname + url.search });
      await route.fulfill({ response });
    } catch (error) {
      await route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "Isolated catalog API failed: " + String(error) }) });
    }
  });
  const page = await context.newPage();
  function expect(id, actual, predicate = Boolean) {
    const passed = predicate(actual);
    row.assertions.push({ id, passed, actual });
    assert.ok(passed, `${name}: ${id}: ${JSON.stringify(actual)}`);
  }
  async function snapshot(target, suffix) {
    await mkdir(OUT, { recursive: true });
    const filename = `${name}-${suffix}.png`;
    await target.screenshot({ path: path.join(OUT, filename), fullPage: true, animations: "disabled" });
    row.screenshots.push(filename);
  }
  async function request(target, endpoint, payload) {
    return target.evaluate(async ({ apiUrl, endpoint, payload }) => {
      const response = await fetch(apiUrl + endpoint, {
        credentials: "include",
        ...(payload === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
      });
      return { status: response.status, body: await response.json() };
    }, { apiUrl: API, endpoint, payload });
  }
  async function state() {
    const response = await request(page, "/api/workspace");
    assert.equal(response.status, 200, JSON.stringify(response));
    return response.body;
  }
  async function action(payload) {
    const response = await request(page, "/api/actions", payload);
    assert.equal(response.status, 200, JSON.stringify(response));
    return response.body;
  }
  try {
    await page.goto(W + "/settings#public-request", { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Public request", exact: true }).waitFor();
    await body({ page, context, state, action, request, expect, snapshot, failNextAction: () => { failAction = true; } });
    await noOverflow(page, expect);
    expect("no browser errors", errors, (items) => items.length === 0);
    await snapshot(page, "complete");
    row.status = "pass";
  } catch (error) {
    row.status = "fail";
    row.error = String(error?.stack || error);
    await snapshot(page, "failure").catch(() => {});
  } finally {
    await context.close();
    await api.stop();
    console.log(row.status.toUpperCase() + " " + name);
    if (row.error) console.error(row.error);
  }
}

async function noOverflow(page, expect) {
  const size = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  expect("no page horizontal overflow", size, (value) => value.document <= value.viewport + 1 && value.body <= value.viewport + 1);
}
async function waitUntil(predicate, message) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  assert.fail(message);
}
function enabledSwitch(page, name, kind) {
  return page.getByRole("switch", { name: `${name} ${kind} enabled`, exact: true });
}
async function catalogTab(page, kind) {
  const label = kind === "ministry" ? "Ministries" : "Request types";
  await page.getByRole("button", { name: label, exact: true }).click();
  await page.getByRole("table", { name: `${label} table`, exact: true }).waitFor();
}
async function setEnabled(page, name, kind, enabled) {
  await catalogTab(page, kind);
  const control = enabledSwitch(page, name, kind);
  await control.scrollIntoViewIfNeeded();
  if ((await control.getAttribute("aria-checked")) !== String(enabled)) await control.locator("xpath=..").click();
  await waitUntil(async () => (await control.getAttribute("aria-checked")) === String(enabled) && !(await control.isDisabled()), `${name} availability did not save`);
}
async function createMinistry(page, name) {
  await catalogTab(page, "ministry");
  await page.getByRole("button", { name: "New ministry", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New ministry", exact: true });
  await dialog.getByLabel("New ministry name", { exact: true }).fill(name);
  await dialog.getByRole("button", { name: "Create ministry", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  await page.getByRole("textbox", { name: `${name} ministry name`, exact: true }).waitFor();
}
async function createType(page, name, department = "Sound", group = "Sound") {
  await catalogTab(page, "request type");
  await page.getByRole("button", { name: "New request type", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New request type", exact: true });
  await dialog.getByLabel("New request type name", { exact: true }).fill(name);
  await dialog.getByLabel("New request type department", { exact: true }).selectOption({ label: department });
  await dialog.getByLabel("New request type group", { exact: true }).selectOption({ label: group });
  await dialog.getByRole("button", { name: "Create request type", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  await page.getByRole("textbox", { name: `${name} request type name`, exact: true }).waitFor();
}
async function newPortalForm(context) {
  const portal = await context.newPage();
  await portal.goto(P, { waitUntil: "networkidle" });
  await portal.getByRole("button", { name: /Make a request/i }).click();
  await portal.getByRole("heading", { name: "Step 1: Request details", exact: true }).waitFor();
  return portal;
}
async function fillRequest(portal, typeName, ministryName, title) {
  await portal.locator("select#service").selectOption({ label: typeName });
  await portal.locator("select#ministry").selectOption({ label: ministryName });
  await portal.getByPlaceholder("e.g. Youth retreat recap video").fill(title);
  await portal.getByPlaceholder("Describe what you need…").fill("An isolated public catalog request.");
  await portal.getByPlaceholder("Anything else we should know?").fill("Catalog settings lifecycle verification.");
  const due = new Date(Date.now() + 7 * 86400000);
  await portal.locator('input[type="datetime-local"]').fill(`${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, "0")}-${String(due.getDate()).padStart(2, "0")}T12:00`);
  await portal.getByRole("button", { name: "Next", exact: true }).click();
  await portal.getByRole("heading", { name: "Step 2: Review and confirm", exact: true }).waitFor();
}
async function options(portal, field) {
  return portal.locator(`select#${field} option`).evaluateAll((nodes) => nodes.filter((node) => node.value).map((node) => ({ value: node.value, label: node.textContent.trim() })));
}
async function selectRows(page, kind, names) {
  await catalogTab(page, kind);
  for (const name of names) {
    const control = page.getByRole("checkbox", { name: `Select ${kind} ${name}`, exact: true });
    await control.scrollIntoViewIfNeeded();
    await control.check();
  }
}
async function bulkDelete(page, kind, names, confirm) {
  await selectRows(page, kind, names);
  const action = kind === "ministry" ? "Delete ministries" : "Delete request types";
  const bar = page.locator('[data-slot="data-table-selection-bar"]').filter({ has: page.getByRole("button", { name: action, exact: true }) });
  await bar.getByRole("button", { name: action, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: `${action}?`, exact: true });
  await dialog.getByRole("button", { name: confirm ? action : "Cancel", exact: true }).click();
  if (!confirm) await dialog.waitFor({ state: "detached" });
  return { dialog, bar };
}

await run("desktop-lifecycle", 1440, async ({ page, context, state, action, request, expect, snapshot, failNextAction }) => {
  expect("request types is the default table", await page.getByRole("table").count(), (value) => value === 1);
  await page.getByRole("heading", { name: "Request types", exact: true }).waitFor();
  await catalogTab(page, "ministry");
  await page.getByRole("heading", { name: "Ministries", exact: true }).waitFor();
  await createMinistry(page, "Catalog Ministry");
  await createType(page, "Catalog Request Type");
  let typeName = "Catalog Request Type";
  let ministryName = "Catalog Ministry";
  const typeEditor = page.getByRole("textbox", { name: `${typeName} request type name`, exact: true });
  await typeEditor.fill("Cancelled request type rename");
  await typeEditor.press("Escape");
  expect("Escape restores request type name", await typeEditor.innerText(), (value) => value === typeName);
  await typeEditor.fill(typeName + " Updated");
  await typeEditor.press("Tab");
  typeName += " Updated";
  await page.getByRole("textbox", { name: `${typeName} request type name`, exact: true }).waitFor();
  await catalogTab(page, "ministry");
  const ministryEditor = page.getByRole("textbox", { name: `${ministryName} ministry name`, exact: true });
  await ministryEditor.fill(ministryName + " Updated");
  await ministryEditor.press("Enter");
  ministryName += " Updated";
  await page.getByRole("textbox", { name: `${ministryName} ministry name`, exact: true }).waitFor();
  await snapshot(page, "managed-tables");
  await page.reload({ waitUntil: "networkidle" });
  const saved = await state();
  const service = saved.catalog.services.find((item) => item.name === typeName);
  expect("request type routing persisted", service, (value) => value?.department === "sound" && value?.subTeam === "Sound");
  expect("ministry rename persisted", saved.catalog.ministries, (values) => values.includes(ministryName));
  const portal = await newPortalForm(context);
  expect("new request type offered publicly", await options(portal, "service"), (values) => values.some((item) => item.label === typeName));
  expect("new ministry offered publicly", await options(portal, "ministry"), (values) => values.some((item) => item.label === ministryName));
  const title = "Catalog availability preserved request";
  await fillRequest(portal, typeName, ministryName, title);
  await portal.getByRole("button", { name: "Send request", exact: true }).click();
  await portal.locator(".request-success").waitFor();
  const code = (await portal.locator(".access-code").innerText()).trim();
  expect("receipt has a private access code", code, (value) => /^MOC-/.test(value));
  const stale = await newPortalForm(context);
  await fillRequest(stale, typeName, ministryName, "Draft whose selected options become unavailable");
  await setEnabled(page, typeName, "request type", false);
  await setEnabled(page, ministryName, "ministry", false);
  await Promise.all([
    stale.waitForResponse((response) => new URL(response.url()).pathname === "/api/catalog"),
    (async () => {
      await stale.bringToFront();
      await stale.evaluate(() => { window.dispatchEvent(new Event("visibilitychange")); });
    })(),
  ]);
  await stale.getByRole("heading", { name: "Step 1: Request details", exact: true }).waitFor();
  expect("catalog refresh clears unavailable draft selections", { service: await stale.locator("select#service").inputValue(), ministry: await stale.locator("select#ministry").inputValue(), title: await stale.getByPlaceholder("e.g. Youth retreat recap video").inputValue() }, (value) => value.service === "" && value.ministry === "" && value.title === "Draft whose selected options become unavailable");
  await stale.getByText("This request type is no longer available. Choose another.", { exact: true }).waitFor();
  await snapshot(stale, "refreshed-draft-options");
  await page.reload({ waitUntil: "networkidle" });
  expect("off request type persists after reload", await enabledSwitch(page, typeName, "request type").getAttribute("aria-checked"), (value) => value === "false");
  await catalogTab(page, "ministry");
  expect("off ministry persists after reload", await enabledSwitch(page, ministryName, "ministry").getAttribute("aria-checked"), (value) => value === "false");
  const fresh = await newPortalForm(context);
  expect("off request type hidden from fresh form", await options(fresh, "service"), (values) => !values.some((item) => item.label === typeName));
  expect("off ministry hidden from fresh form", await options(fresh, "ministry"), (values) => !values.some((item) => item.label === ministryName));
  const staleResponse = await request(fresh, "/api/requests", { title: "Stale catalog draft", ministry: ministryName, service: service.id, instructions: "Stale form fixture.", notes: "Must not be created.", dueAt: new Date(Date.now() + 7 * 86400000).toISOString(), airedDates: [] });
  expect("API rejects disabled choices in stale fresh submission", staleResponse, (value) => value.status === 400 && /(?:unavailable|disabled|no longer|not available|switched off)/i.test(value.body.error));
  await portal.goto(P, { waitUntil: "networkidle" });
  await portal.getByRole("button", { name: /Track a submission/i }).click();
  await portal.getByLabel("Private access code", { exact: false }).fill(code);
  await portal.locator(".track-submit").click();
  await portal.locator(".tracking-summary").waitFor();
  expect("tracking preserves historical type label", await portal.locator("select#service option:checked").innerText(), (value) => value === typeName);
  expect("tracking preserves historical ministry label", await portal.locator("select#ministry option:checked").innerText(), (value) => value === ministryName);
  const alternateService = (await state()).catalog.services.find((item) => item.id !== service.id && item.enabled !== false && !item.requiresAiredDates);
  assert.ok(alternateService, "Fixture has another available request type");
  await portal.locator("select#service").selectOption(alternateService.id);
  await portal.getByPlaceholder("e.g. Youth retreat recap video").fill(title + " edited");
  await action({ type: "save-service", service: { ...alternateService, enabled: false } });
  await Promise.all([
    portal.waitForResponse((response) => new URL(response.url()).pathname === "/api/catalog"),
    (async () => {
      await portal.bringToFront();
      await portal.evaluate(() => { window.dispatchEvent(new Event("visibilitychange")); });
    })(),
  ]);
  await portal.getByText("This request type is no longer available. Choose another.", { exact: true }).waitFor();
  expect("tracking edit clears newly unavailable alternative without losing text", { service: await portal.locator("select#service").inputValue(), title: await portal.getByPlaceholder("e.g. Youth retreat recap video").inputValue() }, (value) => value.service === "" && value.title === title + " edited");
  await portal.locator("select#service").selectOption(service.id);
  await portal.getByRole("button", { name: "Save changes", exact: true }).click();
  await portal.getByText("Changes saved.", { exact: true }).waitFor();
  await snapshot(portal, "disabled-existing-tracking");
  await page.goto(W + "/requests", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: `Open ${title} edited`, exact: true }).click();
  const details = page.getByRole("dialog", { name: "Request details", exact: true });
  expect("existing backlog keeps disabled labels", await details.innerText(), (text) => text.includes(typeName) && text.includes(ministryName));
  await details.getByRole("button", { name: "Approve and route", exact: true }).click();
  await details.waitFor({ state: "detached" });
  const approved = await state();
  expect("disabled historical request still approves with configured routing", approved.tasks.filter((item) => item.title === title + " edited"), (values) => values.length === 1 && values[0].department === "sound" && values[0].subTeam === "Sound");
  await page.goto(W + "/settings#public-request", { waitUntil: "networkidle" });
  for (const name of ["Unused Ministry A", "Unused Ministry B"]) await createMinistry(page, name);
  for (const name of ["Unused Type A", "Unused Type B"]) await createType(page, name);
  const cancelled = await bulkDelete(page, "ministry", ["Unused Ministry A", "Unused Ministry B"], false);
  expect("cancel retains selected ministries", (await state()).catalog.ministries.filter((name) => name.startsWith("Unused Ministry")).length, (value) => value === 2);
  await waitUntil(() => cancelled.bar.getByRole("button", { name: "Delete ministries", exact: true }).evaluate((node) => document.activeElement === node), "Cancel did not restore focus to the selected ministry action");
  await cancelled.bar.getByRole("button", { name: "Delete ministries", exact: true }).click();
  await page.getByRole("dialog", { name: "Delete ministries?", exact: true }).getByRole("button", { name: "Delete ministries", exact: true }).click();
  await page.getByRole("textbox", { name: "Unused Ministry A ministry name", exact: true }).waitFor({ state: "detached" });
  await waitUntil(() => page.getByRole("button", { name: "New ministry", exact: true }).evaluate((node) => document.activeElement === node), "Deleted selection did not restore focus to New ministry");
  expect("confirmed batch removes both unused ministries", (await state()).catalog.ministries.some((name) => name.startsWith("Unused Ministry")), (value) => !value);
  await createMinistry(page, "Unused Ministry C");
  const blockedMinistry = await bulkDelete(page, "ministry", [ministryName, "Unused Ministry C"], true);
  await blockedMinistry.dialog.getByRole("alert").waitFor();
  expect("in-use ministry batch is atomic", (await state()).catalog.ministries.filter((name) => name === ministryName || name === "Unused Ministry C").length, (value) => value === 2);
  await blockedMinistry.dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await blockedMinistry.bar.getByRole("button", { name: "Clear selection", exact: true }).click();
  const blocked = await bulkDelete(page, "request type", [typeName, "Unused Type A"], true);
  await blocked.dialog.getByRole("alert").waitFor();
  expect("in-use batch explains switching off", await blocked.dialog.getByRole("alert").innerText(), (text) => /(?:switch|turn).*(?:off)|disabl/i.test(text));
  expect("in-use batch is atomic", (await state()).catalog.services.filter((item) => item.name === typeName || item.name === "Unused Type A").length, (value) => value === 2);
  await blocked.dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await blocked.bar.getByRole("button", { name: "Clear selection", exact: true }).click();
  const deleted = await bulkDelete(page, "request type", ["Unused Type A", "Unused Type B"], true);
  await deleted.dialog.waitFor({ state: "detached" });
  await waitUntil(() => page.getByRole("button", { name: "New request type", exact: true }).evaluate((node) => document.activeElement === node), "Deleted selection did not restore focus to New request type");
  expect("confirmed unused request types deleted", (await state()).catalog.services.some((item) => item.name.startsWith("Unused Type")), (value) => !value);
  const catalog = (await state()).catalog;
  for (const item of catalog.services) if (item.enabled !== false) await action({ type: "save-service", service: { ...item, enabled: false } });
  for (const name of catalog.ministries) if (!catalog.disabledMinistries?.includes(name)) await action({ type: "set-ministry-enabled", name, enabled: false });
  const empty = await newPortalForm(context);
  await empty.getByText("Requests are temporarily unavailable. Please try again later.", { exact: true }).waitFor();
  expect("all-off request types cannot submit", await empty.getByRole("button", { name: "Next", exact: true }).isDisabled());
  expect("all-off menus have no available choices", { types: await options(empty, "service"), ministries: await options(empty, "ministry") }, (value) => value.types.length === 0 && value.ministries.length === 0);
  await noOverflow(empty, expect);
  await snapshot(empty, "all-disabled-portal");
  await page.reload({ waitUntil: "networkidle" });
  await setEnabled(page, typeName, "request type", true);
  await setEnabled(page, ministryName, "ministry", true);
  failNextAction();
  await enabledSwitch(page, ministryName, "ministry").locator("xpath=..").click();
  await page.getByRole("alert").filter({ hasText: "Catalog fixture temporarily unavailable." }).waitFor();
  expect("failed availability mutation retains enabled value", await enabledSwitch(page, ministryName, "ministry").getAttribute("aria-checked"), (value) => value === "true");
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await waitUntil(async () => await enabledSwitch(page, ministryName, "ministry").getAttribute("aria-checked") === "false", "Retry did not persist ministry availability");
  await setEnabled(page, ministryName, "ministry", true);
  await empty.reload({ waitUntil: "networkidle" });
  await empty.getByRole("button", { name: /Make a request/i }).click();
  expect("reenabling restores only configured active choices", { types: await options(empty, "service"), ministries: await options(empty, "ministry") }, (value) => value.types.length === 1 && value.types[0].label === typeName && value.ministries.length === 1 && value.ministries[0].label === ministryName);
});

await run("phone-management", 390, async ({ page, context, state, expect, snapshot }) => {
  await createMinistry(page, "Phone Ministry");
  await createType(page, "Phone Request Type");
  await catalogTab(page, "ministry");
  const checkbox = page.getByRole("checkbox", { name: "Select ministry Phone Ministry", exact: true });
  await checkbox.scrollIntoViewIfNeeded();
  await checkbox.check();
  const bounds = await checkbox.boundingBox();
  expect("phone selection has a usable target", bounds, (value) => value && value.width >= 44 && value.height >= 44);
  await snapshot(page, "selected-rows");
  const bar = page.locator('[data-slot="data-table-selection-bar"]').filter({ has: page.getByRole("button", { name: "Delete ministries", exact: true }) });
  await bar.getByRole("button", { name: "Delete ministries", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "Delete ministries?", exact: true });
  await noOverflow(page, expect);
  await snapshot(page, "delete-confirmation");
  await confirm.getByRole("button", { name: "Cancel", exact: true }).click();
  await bar.getByRole("button", { name: "Clear selection", exact: true }).click();
  await setEnabled(page, "Phone Request Type", "request type", false);
  await setEnabled(page, "Phone Ministry", "ministry", false);
  await page.reload({ waitUntil: "networkidle" });
  expect("phone disabled ministry persisted", (await state()).catalog.disabledMinistries, (values) => values.includes("Phone Ministry"));
  const portal = await newPortalForm(context);
  expect("phone portal excludes disabled request type", await options(portal, "service"), (values) => !values.some((item) => item.label === "Phone Request Type"));
  await noOverflow(portal, expect);
  await snapshot(portal, "public-options");
});

await run("mutation-recovery", 1440, async ({ page, state, expect, failNextAction, snapshot }) => {
  await catalogTab(page, "ministry");
  const trigger = page.getByRole("button", { name: "New ministry", exact: true });
  await trigger.click();
  let dialog = page.getByRole("dialog", { name: "New ministry", exact: true });
  const input = dialog.getByLabel("New ministry name", { exact: true });
  await waitUntil(() => input.evaluate((node) => document.activeElement === node), "Create dialog did not focus its name field");
  await input.fill("Recovery Ministry");
  failNextAction();
  await dialog.getByRole("button", { name: "Create ministry", exact: true }).click();
  await dialog.getByRole("alert").filter({ hasText: "Catalog fixture temporarily unavailable." }).waitFor();
  expect("failed create preserves its entered name", await input.inputValue(), (value) => value === "Recovery Ministry");
  await snapshot(page, "create-error");
  await dialog.getByRole("button", { name: "Create ministry", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  expect("create can retry without duplicate rows", (await state()).catalog.ministries.filter((name) => name === "Recovery Ministry").length, (value) => value === 1);
  const control = enabledSwitch(page, "Recovery Ministry", "ministry");
  await control.focus();
  await control.press("Space");
  await waitUntil(async () => await control.getAttribute("aria-checked") === "false" && !await control.isDisabled(), "Keyboard switch did not persist disabled value");
  expect("keyboard availability switch has persisted state", (await state()).catalog.disabledMinistries, (values) => values.includes("Recovery Ministry"));
  await trigger.click();
  dialog = page.getByRole("dialog", { name: "New ministry", exact: true });
  await dialog.getByLabel("New ministry name", { exact: true }).fill("Cancelled create");
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  await waitUntil(() => trigger.evaluate((node) => document.activeElement === node), "Escape did not restore create trigger focus");
  expect("cancelled create does not add a ministry", (await state()).catalog.ministries.includes("Cancelled create"), (value) => !value);
});

await run("leader-access", 1440, async ({ page, action, request, expect }) => {
  let response = await request(page, "/api/auth/demo", { department: "sound" });
  assert.equal(response.status, 200, JSON.stringify(response));
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Public request", exact: true }).waitFor();
  await catalogTab(page, "ministry");
  expect("department leaders can manage public request settings", await page.getByRole("button", { name: "New ministry", exact: true }).isVisible());
  expect("department leaders do not gain member administration", await page.getByRole("navigation", { name: "Settings", exact: true }).getByRole("link", { name: "Members", exact: true }).count(), (value) => value === 0);
  await createMinistry(page, "Leader Created Ministry");
  response = await request(page, "/api/auth/demo", { department: "cell-0" });
  assert.equal(response.status, 200, JSON.stringify(response));
  await action({ type: "update-member", userId: "leader-sound", changes: { isLeader: false } });
  response = await request(page, "/api/auth/demo", { department: "sound" });
  assert.equal(response.status, 200, JSON.stringify(response));
  await page.reload({ waitUntil: "networkidle" });
  expect("ordinary approved member cannot see public management controls", await page.getByRole("button", { name: "New ministry", exact: true }).count(), (value) => value === 0);
  const denied = await request(page, "/api/actions", { type: "save-ministry", name: "Forbidden Ministry" });
  expect("ordinary member management is rejected server-side", denied, (value) => value.status === 400 && /leader|permission|manage|allowed/i.test(value.body.error));
});

await browser.close();
await mkdir(OUT, { recursive: true });
await writeFile(path.join(OUT, "coverage.json"), JSON.stringify(report, null, 2) + "\n");
if (report.cases.some((row) => row.status !== "pass")) process.exitCode = 1;
