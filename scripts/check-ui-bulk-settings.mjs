#!/usr/bin/env node
/**
 * Settings bulk selection checks against a disposable API store.
 * Requires the workspace dev server; never mutates the running demo API.
 */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { startUiTestApi } from "./ui-test-server.mjs";

const W = process.env.WORKSPACE_URL || "http://localhost:5173";
const API = process.env.API_URL || "http://localhost:3001";
const OUT = path.resolve(process.env.UI_BULK_OUT || "output/reviews/lifecycle-unification/bulk");
const only = process.argv.find((arg) => arg.startsWith("--only="))?.slice(7);
const results = { isolatedApi: true, generatedAt: new Date().toISOString(), cases: [] };
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined });

async function check(name, viewport, body) {
  const result = { name, viewport, status: "running", assertions: [], error: null };
  results.cases.push(result);
  const api = await startUiTestApi([new URL(W).origin]);
  const context = await browser.newContext({ viewport, timezoneId: "Africa/Johannesburg", reducedMotion: "reduce" });
  let nextActionFailure = false;
  const errors = [];
  const actions = [];
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    // A deliberately injected HTTP failure is checked through the rendered alert.
    if (message.type() === "error" && !/Failed to load resource:.*(?:400|409|503)/.test(message.text())) errors.push(message.text());
  });
  await context.route(API + "/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "POST" && url.pathname === "/api/actions") {
      actions.push(request.postDataJSON());
      if (nextActionFailure) {
        nextActionFailure = false;
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Bulk fixture temporarily unavailable." }) });
        return;
      }
    }
    try {
      const response = await route.fetch({ url: api.url + url.pathname + url.search });
      await route.fulfill({ response });
    } catch (error) {
      await route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "Disposable fixture API failed: " + String(error) }) });
    }
  });
  function expect(id, value, predicate = Boolean) {
    result.assertions.push({ id, passed: predicate(value), actual: value });
    assert.ok(predicate(value), `${name}: ${id}: ${JSON.stringify(value)}`);
  }
  async function state() {
    return page.evaluate(async (url) => {
      const response = await fetch(url + "/api/workspace", { credentials: "include" });
      if (!response.ok) throw new Error("Fixture workspace read failed: " + response.status);
      return response.json();
    }, API);
  }
  async function action(payload) {
    const response = await page.evaluate(async ({ url, payload }) => {
      const response = await fetch(url + "/api/actions", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      return { status: response.status, body: await response.json() };
    }, { url: API, payload });
    assert.equal(response.status, 200, JSON.stringify(response));
    return response.body;
  }
  async function snapshot(suffix) {
    await mkdir(OUT, { recursive: true });
    await page.screenshot({ path: path.join(OUT, `${name}-${suffix}.png`), fullPage: true, animations: "disabled" });
  }
  try {
    await page.goto(W + "/settings", { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Members", exact: true }).waitFor();
    await body({ page, expect, state, action, actions, failNextAction: () => { nextActionFailure = true; }, snapshot });
    const size = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
    expect("no page horizontal overflow", size, (value) => value.document <= value.viewport + 1 && value.body <= value.viewport + 1);
    expect("no browser errors", errors, (value) => value.length === 0);
    await snapshot("complete");
    result.status = "pass";
  } catch (error) {
    result.status = "fail";
    result.error = String(error?.stack || error);
    await snapshot("failure").catch(() => {});
  } finally {
    await context.close();
    await api.stop();
    console.log(result.status.toUpperCase() + " " + name);
    if (result.error) console.error(result.error);
  }
}

// Confirm dialogs correctly hide the background from the accessibility tree;
// include it only so read assertions can inspect the preserved selection.
function rowCheckbox(page, name) { return page.getByRole("checkbox", { name: `Select ${name}`, exact: true, includeHidden: true }); }
function headerCheckbox(page) { return page.getByRole("checkbox", { name: /^Select all (?:rows|members|departments)$/ }); }
function selectionBar(page) { return page.locator('[data-slot="data-table-selection-bar"]'); }
async function select(page, name) {
  const checkbox = rowCheckbox(page, name);
  await checkbox.scrollIntoViewIfNeeded();
  await checkbox.check();
}
async function assertSelection(page, count) {
  const bar = selectionBar(page);
  await bar.waitFor();
  assert.match(await bar.innerText(), new RegExp(`\\b${count} (?:members |departments )?selected\\b`));
}
async function assertSelectionTarget(page, checkbox, expect) {
  const target = await checkbox.boundingBox();
  const phone = page.viewportSize().width <= 767;
  expect("selection checkbox target size", target, (value) => value && value.width >= (phone ? 44 : 16) && value.height >= (phone ? 44 : 16));
  if (phone) {
    const visual = await checkbox.locator(':scope > span[aria-hidden="true"]').boundingBox();
    expect("phone checkbox retains compact visual", visual, (value) => value && value.width === 16 && value.height === 16);
  }
}
async function dismissWithEscape(page, dialog, trigger) {
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  await page.waitForTimeout(300);
  const focus = await trigger.evaluate((node) => ({
    returned: document.activeElement === node,
    active: document.activeElement?.outerHTML.slice(0, 500),
    trigger: node.outerHTML.slice(0, 500),
  }));
  assert.equal(focus.returned, true, "Escape restores focus to bulk action: " + JSON.stringify(focus));
}

async function departmentCase(test) {
  const { page, expect, state, action, actions, failNextAction, snapshot } = test;
  for (const [id, name] of [["bulk-empty-a", "Bulk empty A"], ["bulk-empty-b", "Bulk empty B"]]) {
    await action({ type: "save-department", department: { id, name, color: "cyan", groups: ["General"] } });
  }
  await page.goto(W + "/settings#departments", { waitUntil: "networkidle" });
  // Hash-only navigation keeps React Query's current workspace cached. The
  // fixture setup bypassed the app action hook, so reload before inspecting it.
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Departments", exact: true }).waitFor();
  expect("protected Cell 0 cannot be selected", await rowCheckbox(page, "Cell 0").isDisabled());
  expect("no per-department options", await page.getByRole("button", { name: /department options/ }).count(), (value) => value === 0);
  await select(page, "Bulk empty A");
  await assertSelectionTarget(page, rowCheckbox(page, "Bulk empty A"), expect);
  await assertSelection(page, 1);
  expect("partially selected header", await headerCheckbox(page).getAttribute("aria-checked"), (value) => value === "mixed");
  expect("selected row is highlighted", await rowCheckbox(page, "Bulk empty A").locator("xpath=ancestor::tr").getAttribute("data-state"), (value) => value === "selected");
  expect("selection leaves name editor at rest", await page.getByRole("textbox", { name: "Bulk empty A department name", exact: true }).evaluate((node) => document.activeElement === node), (value) => !value);
  await snapshot("mixed-selection");
  await headerCheckbox(page).check();
  const eligible = (await state()).catalog.departments.filter((department) => department.id !== "cell-0").length;
  await assertSelection(page, eligible);
  expect("select all skips protected Cell 0", await rowCheckbox(page, "Cell 0").isChecked(), (value) => !value);
  await selectionBar(page).getByRole("button", { name: "Clear selection", exact: true }).click();
  await selectionBar(page).waitFor({ state: "detached" });
  for (const name of ["Bulk empty A", "Bulk empty B"]) await select(page, name);
  const deleteButton = selectionBar(page).getByRole("button", { name: "Delete departments", exact: true });
  await deleteButton.click();
  let dialog = page.getByRole("dialog", { name: "Delete departments?", exact: true });
  await dialog.waitFor();
  await dismissWithEscape(page, dialog, deleteButton);
  await assertSelection(page, 2);
  await snapshot("delete-selection");
  await deleteButton.click();
  dialog = page.getByRole("dialog", { name: "Delete departments?", exact: true });
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  const cancelled = (await state()).catalog.departments;
  expect("cancel preserves both departments", cancelled.filter((item) => item.id.startsWith("bulk-empty-")).length, (value) => value === 2);
  await deleteButton.click();
  await page.getByRole("dialog", { name: "Delete departments?", exact: true }).getByRole("button", { name: "Delete departments", exact: true }).click();
  await rowCheckbox(page, "Bulk empty A").waitFor({ state: "detached" });
  await selectionBar(page).waitFor({ state: "detached" });
  expect("confirm deletes entire selected batch", (await state()).catalog.departments.some((item) => item.id.startsWith("bulk-empty-")), (value) => !value);
  await action({ type: "save-department", department: { id: "bulk-empty-a", name: "Bulk empty A", color: "cyan", groups: ["General"] } });
  await page.reload({ waitUntil: "networkidle" });
  await select(page, "Bulk empty A");
  await select(page, "Design");
  await selectionBar(page).getByRole("button", { name: "Delete departments", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Delete departments?", exact: true });
  await dialog.getByRole("button", { name: "Delete departments", exact: true }).click();
  await dialog.getByRole("alert").waitFor();
  expect("in-use rejection preserves every selected department", (await state()).catalog.departments.filter((item) => ["bulk-empty-a", "design"].includes(item.id)).length, (value) => value === 2);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await selectionBar(page).getByRole("button", { name: "Clear selection", exact: true }).click();
  await select(page, "Bulk empty A");
  await selectionBar(page).getByRole("button", { name: "Delete departments", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Delete departments?", exact: true });
  failNextAction();
  await dialog.getByRole("button", { name: "Delete departments", exact: true }).click();
  await dialog.getByRole("alert").filter({ hasText: "Bulk fixture temporarily unavailable." }).waitFor();
  expect("failed mutation retains selection", await rowCheckbox(page, "Bulk empty A").isChecked());
  await snapshot("delete-retry");
  await dialog.getByRole("button", { name: /^(?:Try again|Delete departments)$/ }).click();
  await rowCheckbox(page, "Bulk empty A").waitFor({ state: "detached" });
  expect("retry removes selected department", (await state()).catalog.departments.some((item) => item.id === "bulk-empty-a"), (value) => !value);
  expect("department deletion uses a single request for each batch", actions.filter((entry) => entry.type === "delete-departments").length === 4 && actions.find((entry) => entry.type === "delete-departments").departmentIds.length === 2);
}

async function memberCase(test) {
  const { page, expect, state, action, actions, failNextAction, snapshot } = test;
  for (const name of ["Bulk member A", "Bulk member B"]) {
    await action({ type: "invite-member", input: { name, email: name.toLowerCase().replaceAll(" ", ".") + "@example.org", duty: "TJN", department: "design", groups: ["Graphic Design"], isLeader: false } });
  }
  await page.reload({ waitUntil: "networkidle" });
  const initial = await state();
  const actor = initial.users.find((member) => member.department === "cell-0");
  assert.ok(actor, "fixture contains Cell 0 actor");
  expect("current actor cannot be selected", await rowCheckbox(page, actor.name).isDisabled());
  await select(page, "Bulk member A");
  await assertSelectionTarget(page, rowCheckbox(page, "Bulk member A"), expect);
  await assertSelection(page, 1);
  expect("member header is partially selected", await headerCheckbox(page).getAttribute("aria-checked"), (value) => value === "mixed");
  await headerCheckbox(page).check();
  await assertSelection(page, initial.users.length - 1);
  expect("select all leaves current actor unselected", await rowCheckbox(page, actor.name).isChecked(), (value) => !value);
  await selectionBar(page).getByRole("button", { name: "Clear selection", exact: true }).click();
  for (const name of ["Bulk member A", "Bulk member B"]) await select(page, name);
  await assertSelection(page, 2);
  await snapshot("move-selection");
  const moveButton = selectionBar(page).getByRole("button", { name: "Move to department", exact: true });
  await moveButton.click();
  let dialog = page.getByRole("dialog", { name: "Move members", exact: true });
  await dialog.waitFor();
  expect("move requires a destination", await dialog.getByRole("button", { name: "Move members", exact: true }).isDisabled());
  await dismissWithEscape(page, dialog, moveButton);
  await assertSelection(page, 2);
  await moveButton.click();
  dialog = page.getByRole("dialog", { name: "Move members", exact: true });
  await dialog.getByRole("combobox", { name: "Edit Destination department", exact: true }).click();
  await page.getByRole("option", { name: "Sound", exact: true }).click();
  const groupCombo = dialog.getByRole("combobox", { name: "Edit Destination groups", exact: true });
  if (await dialog.getByRole("button", { name: "Move members", exact: true }).isDisabled()) {
    await groupCombo.click();
    await page.getByRole("option", { name: "Sound", exact: true }).click();
    await page.keyboard.press("Escape");
  }
  failNextAction();
  await dialog.getByRole("button", { name: "Move members", exact: true }).click();
  await dialog.getByRole("alert").filter({ hasText: "Bulk fixture temporarily unavailable." }).waitFor();
  expect("move failure retains selected members", await rowCheckbox(page, "Bulk member A").isChecked() && await rowCheckbox(page, "Bulk member B").isChecked());
  expect("failed move changes no members", (await state()).users.filter((member) => member.name.startsWith("Bulk member")).every((member) => member.department === "design"));
  expect("move failure retains destination", await dialog.getByRole("combobox", { name: "Edit Destination department", exact: true }).innerText(), (value) => value === "Sound");
  expect("move failure retains groups", await groupCombo.innerText(), (value) => value === "Sound");
  await snapshot("move-retry");
  await dialog.getByRole("button", { name: /^(?:Try again|Move members)$/ }).click();
  await dialog.waitFor({ state: "detached" });
  await selectionBar(page).waitFor({ state: "detached" });
  expect("move updates both department and groups atomically", (await state()).users.filter((member) => member.name.startsWith("Bulk member")).every((member) => member.department === "sound" && member.groups.join("|") === "Sound"));
  for (const name of ["Bulk member A", "Bulk member B"]) {
    if (!(await rowCheckbox(page, name).isChecked())) await select(page, name);
    const row = rowCheckbox(page, name).locator("xpath=ancestor::tr");
    expect(name + " updated in rendered row", await row.getByRole("combobox", { name: `Edit ${name} department`, exact: true }).innerText(), (value) => value === "Sound");
  }
  const removeButton = selectionBar(page).getByRole("button", { name: "Remove members", exact: true });
  await removeButton.click();
  dialog = page.getByRole("dialog", { name: "Remove members?", exact: true });
  await dialog.waitFor();
  await dismissWithEscape(page, dialog, removeButton);
  await assertSelection(page, 2);
  await removeButton.click();
  dialog = page.getByRole("dialog", { name: "Remove members?", exact: true });
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect("cancel preserves both members", (await state()).users.filter((member) => member.name.startsWith("Bulk member")).length, (value) => value === 2);
  await removeButton.click();
  await page.getByRole("dialog", { name: "Remove members?", exact: true }).getByRole("button", { name: "Remove members", exact: true }).click();
  await rowCheckbox(page, "Bulk member A").waitFor({ state: "detached" });
  await selectionBar(page).waitFor({ state: "detached" });
  expect("remove confirms entire selected batch", (await state()).users.some((member) => member.name.startsWith("Bulk member")), (value) => !value);
  expect("bulk actions use one request per batch", actions.filter((action) => action.type === "move-members").length === 2 && actions.filter((action) => action.type === "delete-members").length === 1);
}

try {
  for (const [size, viewport] of Object.entries({ desktop: { width: 1440, height: 960 }, phone: { width: 390, height: 844 } })) {
    if (!only || only === "departments") await check(`departments-${size}`, viewport, departmentCase);
    if (!only || only === "members") await check(`members-${size}`, viewport, memberCase);
  }
} finally {
  await browser.close();
  await mkdir(OUT, { recursive: true });
  await writeFile(path.join(OUT, "results.json"), JSON.stringify(results, null, 2) + "\n");
}
process.exitCode = results.cases.some((result) => result.status !== "pass") ? 1 : 0;
