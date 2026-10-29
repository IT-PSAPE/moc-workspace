import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { startUiTestApi, routeUiTestApi } from "./ui-test-server.mjs";

const workspaceUrl = process.env.WORKSPACE_URL || "http://localhost:5173";
const portalUrl = process.env.PORTAL_URL || "http://localhost:5174";
const clientApiUrl = process.env.API_URL || "http://localhost:3001";
const isolated = await startUiTestApi([
  new URL(workspaceUrl).origin,
  new URL(portalUrl).origin,
]);
let browser;
const output = process.env.UI_FLOW_OUT || ".shots/flows";
await mkdir(output, { recursive: true });
const pad = (n) => String(n).padStart(2, "0");
function futureInput(hours) {
  const date = new Date(Date.now() + hours * 3600000);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
async function snap(page, name, width) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    window.scrollTo(0, 0);
  });
  await page.screenshot({
    path: `${output}/${width}-${name}.png`,
    animations: "disabled",
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
    `${name} horizontal overflow at ${width}px`,
  );
}
async function assertFloatingDetails(page, label) {
  const panel = page.locator('.modal-panel[data-side="right"]');
  await panel.waitFor();
  const geometry = await panel.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return { top: rect.top, right: innerWidth - rect.right, bottom: innerHeight - rect.bottom, radius: parseFloat(getComputedStyle(node).borderRadius), width: rect.width };
  });
  assert.ok(geometry.top > 0 && geometry.right > 0 && geometry.bottom > 0 && geometry.radius > 0, label + " uses the shared floating detail drawer");
  assert.equal(await panel.locator(".task-detail-tabs").count(), 0, label + " has inline comments without tabs");
  return geometry.width;
}

async function columnGeometry(table) {
  await table.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return table.locator("thead tr:first-child th").evaluateAll((cells) =>
    cells.map((cell) => ({ left: cell.offsetLeft, width: cell.offsetWidth })),
  );
}
try {
  browser = await chromium.launch(
    process.env.PLAYWRIGHT_CHANNEL
      ? { channel: process.env.PLAYWRIGHT_CHANNEL }
      : {},
  );
  const catalog = await fetch(`${isolated.url}/api/catalog`).then((response) =>
    response.json(),
  );
  const service = catalog.services.find((item) => !item.requiresAiredDates);
  assert.ok(service);
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      reducedMotion: "reduce",
    });
    await routeUiTestApi(context, clientApiUrl, isolated.url);
    const portal = await context.newPage();
    const errors = [];
    context.on("page", (page) =>
      page.on("pageerror", (error) => errors.push(error.message)),
    );
    portal.on("pageerror", (error) => errors.push(error.message));
    await portal.goto(portalUrl, { waitUntil: "networkidle" });
    await snap(portal, "portal-home", width);
    await portal.getByRole("button", { name: /Make a request/ }).click();
    await portal.getByRole("button", { name: "Next", exact: true }).click();
    assert.ok(
      await portal.getByRole("alert").count(),
      "Empty first step is blocked",
    );
    await snap(portal, "portal-validation", width);
    const title = `Console UI flow ${width}`;
    await portal.locator("select#ministry").selectOption(catalog.ministries[0]);
    await portal.locator("select#service").selectOption(service.id);
    await portal.getByPlaceholder("e.g. Youth retreat recap video").fill(title);
    await portal
      .getByPlaceholder("Describe what you need…")
      .fill("Prepare the ministry artwork for the upcoming service.");
    await portal
      .getByPlaceholder("Anything else we should know?")
      .fill("UI verification data in a disposable API store.");
    await snap(portal, "portal-details", width);
    const completionDate = futureInput(3);
    await portal.locator('input[type="datetime-local"]').fill(completionDate);
    await portal.locator(".short-notice").waitFor();
    await snap(portal, "portal-short-notice", width);
    await portal.getByRole("button", { name: "Next", exact: true }).click();
    await portal.getByRole("button", { name: "Back", exact: true }).click();
    const preservedDate = await portal
      .locator('input[type="datetime-local"]')
      .inputValue();
    assert.equal(
      preservedDate,
      completionDate,
      "Back preserves the timing draft",
    );
    await portal.getByRole("button", { name: "Next", exact: true }).click();
    await snap(portal, "portal-review", width);
    assert.match(
      await portal.locator(".request-form").innerText(),
      new RegExp(title),
    );
    await portal
      .getByRole("button", { name: "Send request", exact: true })
      .click();
    await portal.locator(".request-success").waitFor();
    const code = (await portal.locator(".access-code").innerText()).trim();
    assert.match(code, /^MOC-/);
    assert.equal(portal.url().includes(code), false);
    assert.equal(
      await portal.evaluate(
        (value) =>
          JSON.stringify(localStorage).includes(value) ||
          JSON.stringify(sessionStorage).includes(value),
        code,
      ),
      false,
    );
    await snap(portal, "portal-receipt", width);
    await portal.getByRole("button", { name: /Track this request/ }).click();
    await portal.locator(".tracking-summary").waitFor();
    const editedTitle = `${title} edited`;
    await portal
      .getByPlaceholder("e.g. Youth retreat recap video")
      .fill(editedTitle);
    await portal
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await portal.getByText("Changes saved.", { exact: true }).waitFor();
    assert.equal(
      await portal.locator(".tracking-summary h3").innerText(),
      editedTitle,
    );
    await snap(portal, "portal-pending-edit", width);

    const workspace = await context.newPage();
    await workspace.goto(`${workspaceUrl}/requests`, {
      waitUntil: "networkidle",
    });
    const requestStatus = workspace.getByRole("group", {
      name: "Filter requests by status",
      exact: true,
    });
    const backlogStatus = requestStatus.getByRole("button", {
      name: /^Backlog · \d+$/,
    });
    assert.equal(await backlogStatus.getAttribute("aria-pressed"), "true");
    const requestTable = workspace.locator(".requests-data-table");
    const requestColumnGeometry = await columnGeometry(requestTable);
    const backlogRequestCount = await workspace.locator(".request-row").count();
    assert.ok(backlogRequestCount > 0, "Default request filter shows backlog work");
    const approvedStatus = requestStatus.getByRole("button", {
      name: /^Approved · \d+$/,
    });
    await approvedStatus.click();
    assert.deepEqual(await columnGeometry(requestTable), requestColumnGeometry, "Request columns stay fixed when status changes");
    assert.equal(await approvedStatus.getAttribute("aria-pressed"), "true");
    assert.equal(
      await workspace.locator(".request-list").getAttribute("aria-label"),
      "approved requests",
    );
    await requestStatus.getByRole("button", { name: /^Rejected · \d+$/ }).click();
    assert.deepEqual(await columnGeometry(requestTable), requestColumnGeometry, "Rejected requests preserve the same columns");
    const allStatuses = requestStatus.getByRole("button", {
      name: /^All requests · \d+$/,
    });
    await allStatuses.click();
    assert.equal(await allStatuses.getAttribute("aria-pressed"), "true");
    assert.equal(
      await workspace.locator(".request-list").getAttribute("aria-label"),
      "all requests",
    );
    assert.ok(
      (await workspace.locator(".request-row").count()) >= backlogRequestCount,
      "Resetting request filters restores all statuses",
    );
    assert.deepEqual(await columnGeometry(requestTable), requestColumnGeometry, "Request columns stay fixed when all rows are restored");
    const requestSearch = workspace.getByRole("textbox", { name: "Search requests", exact: true });
    await requestSearch.fill("no-match-column-width-check");
    assert.equal(await workspace.locator(".request-row").count(), 0);
    assert.deepEqual(await columnGeometry(requestTable), requestColumnGeometry, "Empty results preserve the same columns");
    await requestSearch.fill("");
    const requestHeaders = (await requestTable.locator("thead th").allTextContents()).map((x) => x.trim());
    assert.deepEqual(
      requestHeaders,
      ["Task", "Ministry", "Service", "Due date", "Group", "Department", "Status"],
      "Requests use separate, named data columns",
    );
    const requestTrigger = workspace.getByRole("button", { name: `Open ${editedTitle}`, exact: true });
    const editedRequestRow = requestTable.locator("tbody tr").filter({ has: requestTrigger });
    await editedRequestRow.waitFor();
    const requestRowText = await editedRequestRow.innerText();
    assert.equal(requestRowText.includes(code), false, "The private access code is never rendered in the request table");
    const dueCell = editedRequestRow.locator('[data-label="Due date"]');
    const shortNotice = dueCell.getByRole("button", { name: "Short notice", exact: true });
    await shortNotice.hover();
    await workspace.getByRole("tooltip", { name: "Short notice", exact: true }).waitFor();
    assert.equal(await dueCell.locator(".badge").count(), 0, "Table notices use a trailing icon instead of a badge");
    const noticeAlignment = await dueCell.evaluate((cell) => {
      const time = cell.querySelector("time").getBoundingClientRect();
      const icon = cell.querySelector("button").getBoundingClientRect();
      return { sameLine: Math.abs((time.y + time.height / 2) - (icon.y + icon.height / 2)) < 2, trailing: icon.x >= time.right };
    });
    assert.ok(noticeAlignment.sameLine && noticeAlignment.trailing, "The notice icon stays inline after the date");
    await shortNotice.press("Escape");
    await workspace.mouse.move(0, 0);
    await workspace.getByRole("textbox", { name: "Search requests", exact: true }).focus();
    await shortNotice.focus();
    await workspace.getByRole("tooltip", { name: "Short notice", exact: true }).waitFor();
    await shortNotice.press("Escape");
    const badgeReadability = await editedRequestRow.locator('[data-label="Department"] .badge, [data-label="Group"] .badge').evaluateAll((nodes) => {
      const rgb = (value) => (value.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
      const luminance = (value) => {
        const [r, g, b] = rgb(value).map((channel) => channel / 255).map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      return nodes.map((node) => {
        const style = getComputedStyle(node);
        const fg = luminance(style.color);
        const bg = luminance(style.backgroundColor);
        return { label: node.textContent?.trim(), foreground: style.color, background: style.backgroundColor, contrast: (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05) };
      });
    });
    assert.ok(badgeReadability.length >= 2 && badgeReadability.every((item) => item.contrast >= 4.5), "Department and group badges have readable foreground/background colors");
    await requestTrigger.click();
    await workspace
      .getByRole("heading", { name: "Request details", exact: true })
      .waitFor();
    const detailWidth = await assertFloatingDetails(workspace, "Request details");
    await snap(workspace, "request-approval", width);
    await workspace
      .getByRole("button", { name: "Approve and route", exact: true })
      .click();
    await workspace.locator(".modal-panel").waitFor({ state: "hidden" });
    await portal.locator(".track-submit").click();
    await portal.locator(".status-approved").waitFor();
    assert.equal(
      await portal
        .getByRole("button", { name: "Save changes", exact: true })
        .count(),
      0,
      "Reviewed requests cannot be edited",
    );
    await snap(portal, "portal-approved", width);

    await workspace.goto(`${workspaceUrl}/departments/${service.department}`, {
      waitUntil: "networkidle",
    });
    await workspace
      .getByRole("button", { name: `Open ${editedTitle}`, exact: true })
      .click();
    assert.equal(await assertFloatingDetails(workspace, "Department task details"), detailWidth);
    await workspace.getByRole("button", { name: "In progress", exact: true }).click();
    await workspace.locator(".modal-panel").waitFor({ state: "hidden" });
    await workspace.getByRole("button", { name: `Open ${editedTitle}`, exact: true }).click();
    await workspace.getByRole("button", { name: "Complete", exact: true }).click();
    await workspace.locator(".modal-panel").waitFor({ state: "hidden" });
    const lifecycleState = await workspace.evaluate(async (api) => fetch(api + "/api/workspace").then((response) => response.json()), clientApiUrl);
    const savedRequest = lifecycleState.requests.find((item) => item.title === editedTitle);
    const savedTask = lifecycleState.tasks.find((item) => item.requestId === savedRequest.id);
    for (const milestone of ["receivedAt", "approvedAt", "inProgressAt", "completedAt"]) {
      assert.ok(Number.isFinite(Date.parse(savedTask.lifecycle[milestone])), milestone + " is recorded");
      assert.equal(savedRequest.lifecycle[milestone], savedTask.lifecycle[milestone], milestone + " stays synchronized");
    }
    assert.equal(Object.hasOwn(savedTask, "completedAt"), false, "Completion lives in the lifecycle JSON object");
    await workspace
      .getByRole("button", { name: `Open ${editedTitle}`, exact: true })
      .click();
    await workspace
      .getByRole("textbox", { name: "Add a comment", exact: true })
      .fill("Private verification note, visible only to leaders.");
    await workspace
      .getByRole("button", { name: "Post comment", exact: true })
      .click();
    await workspace
      .getByText("Private verification note, visible only to leaders.", {
        exact: true,
      })
      .waitFor();
    await workspace
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await workspace.locator(".modal-panel").waitFor({ state: "hidden" });
    await workspace
      .getByRole("button", { name: `Open ${editedTitle}`, exact: true })
      .click();
    await workspace
      .getByText("Private verification note, visible only to leaders.", {
        exact: true,
      })
      .waitFor();
    await snap(workspace, "completed-task-detail", width);
    await portal.locator(".track-submit").click();
    await portal.locator(".status-completed").waitFor();
    assert.equal(
      (await portal.locator("body").innerText()).includes(
        "Private verification note",
      ),
      false,
    );
    await snap(portal, "portal-completed", width);

    await workspace.goto(`${workspaceUrl}/departments`, {
      waitUntil: "networkidle",
    });
    const overviewRows = workspace.locator(".task-table tbody tr");
    const overviewHeaders = (await workspace.locator(".task-table thead th").allTextContents()).map((x) => x.trim());
    assert.deepEqual(overviewHeaders, ["Task", "Ministry", "Service", "Due date", "Group", "Department", "Status"]);
    await workspace.locator(".task-table").getByRole("button", { name: `Open ${editedTitle}`, exact: true }).click();
    assert.equal(await assertFloatingDetails(workspace, "Department overview task details"), detailWidth);
    await workspace.getByRole("button", { name: "Close dialog", exact: true }).click();
    await workspace.locator(".modal-panel").waitFor({ state: "hidden" });
    const allOverviewRows = await overviewRows.count();
    const overviewFilters = workspace.getByRole("button", {
      name: /^Filters/,
    });
    await overviewFilters.click();
    const overviewStatus = workspace.getByRole("combobox", {
      name: "Filter tasks by status",
      exact: true,
    });
    await overviewStatus.selectOption("completed");
    const completedOverviewRows = await overviewRows.count();
    assert.ok(completedOverviewRows > 0 && completedOverviewRows < allOverviewRows);
    const overviewStatusCells = await workspace
      .locator('.task-table tbody td[data-label="Status"]')
      .allInnerTexts();
    assert.ok(overviewStatusCells.every((status) => /completed/i.test(status)));
    await workspace
      .getByRole("button", { name: "Reset filters", exact: true })
      .click();
    assert.equal(await overviewStatus.inputValue(), "all");
    assert.equal(await overviewRows.count(), allOverviewRows);
    await workspace.getByRole("button", { name: "Done", exact: true }).click();
    await workspace
      .getByRole("textbox", { name: "Search tasks", exact: true })
      .filter({ visible: true })
      .last()
      .fill("no-match-verify-ui");
    await workspace
      .getByText("No tasks match these filters", { exact: true })
      .waitFor();
    await snap(workspace, "task-search-empty", width);
    await workspace.goto(`${workspaceUrl}/departments/sound`, {
      waitUntil: "networkidle",
    });
    const soundCards = workspace.locator(".task-card");
    const allSoundCards = await soundCards.count();
    const soundFilters = workspace.getByRole("button", { name: /^Filters/ });
    await soundFilters.click();
    const groupFilter = workspace.getByRole("combobox", {
      name: "Filter by group",
      exact: true,
    });
    const boardStatus = workspace.getByRole("combobox", {
      name: "Filter by status",
      exact: true,
    });
    await groupFilter.selectOption("Sound");
    assert.ok(await soundCards.count() > 0, "Sound group filter returns work");
    await boardStatus.selectOption("completed");
    const completedSoundCards = await soundCards.count();
    assert.ok(completedSoundCards > 0 && completedSoundCards < allSoundCards);
    await workspace
      .getByRole("button", { name: "Reset filters", exact: true })
      .click();
    assert.equal(await groupFilter.inputValue(), "all");
    assert.equal(await boardStatus.inputValue(), "all");
    assert.equal(await soundCards.count(), allSoundCards);
    await workspace.getByRole("button", { name: "Done", exact: true }).click();
    await workspace.goto(`${workspaceUrl}/calendar`, {
      waitUntil: "networkidle",
    });
    await workspace
      .getByRole("button", { name: "Next month", exact: true })
      .click();
    await snap(workspace, "calendar-next-month", width);
    await workspace
      .getByRole("button", { name: "Previous month", exact: true })
      .click();
    if (width < 768) {
      await workspace
        .locator(".schedule-day")
        .filter({ has: workspace.locator(".schedule-event") })
        .first()
        .locator(".schedule-day-number")
        .click();
      await workspace
        .getByRole("dialog")
        .locator(".calendar-task")
        .first()
        .click();
    } else await workspace.locator(".calendar-task").first().click();
    await workspace
      .getByRole("heading", { name: "Task details", exact: true })
      .waitFor();
    assert.equal(await assertFloatingDetails(workspace, "Calendar task details"), detailWidth);
    await snap(workspace, "calendar-detail", width);
    await workspace.goto(`${workspaceUrl}/reports`, {
      waitUntil: "networkidle",
    });
    const reportTable = workspace.locator('[data-slot="data-table"] table');
    const reportHeaders = (await reportTable.locator("thead th").allTextContents()).map((x) => x.trim());
    assert.deepEqual(reportHeaders, ["Task", "Ministry", "Service", "Due date", "Group", "Department", "Status", "Received date", "Approved date", "Rejected date", "In progress date", "Completed date"]);
    const palette = await reportTable.locator('[data-label="Department"] .badge, [data-label="Group"] .badge').evaluateAll((nodes) => {
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
    assert.ok(palette.length > 0 && palette.every((item) => item.contrast >= 4.5), "Report department/group badges have readable palette contrast");
    await reportTable.getByRole("button", { name: `Open ${editedTitle}`, exact: true }).click();
    assert.equal(await assertFloatingDetails(workspace, "Report task details"), detailWidth);
    await workspace.getByRole("button", { name: "Close dialog", exact: true }).click();
    await workspace.locator(".modal-panel").waitFor({ state: "hidden" });
    const downloadPromise = workspace.waitForEvent("download");
    await workspace.getByRole("button", { name: /Export/ }).click();
    const download = await downloadPromise;
    assert.match(download.suggestedFilename(), /\.csv$/);
    const csv = await readFile(await download.path(), "utf8");
    assert.ok(csv.includes(reportHeaders.map((header) => `"${header}"`).join(",")), "CSV preserves the shared task columns and lifecycle date columns");
    assert.ok(csv.includes(savedTask.lifecycle.completedAt), "CSV exports recorded lifecycle dates");
    const reportColumnGeometry = await columnGeometry(reportTable);
    const reportMonth = workspace.locator('.report-month-controls strong');
    const originalMonth = await reportMonth.innerText();
    await workspace.getByRole("button", { name: "Next month", exact: true }).click();
    assert.notEqual(await reportMonth.innerText(), originalMonth, "Report month control updates the reporting period");
    assert.deepEqual(await columnGeometry(reportTable), reportColumnGeometry, "Report column widths remain stable between periods");
    await workspace.getByRole("button", { name: "Previous month", exact: true }).click();
    assert.equal(await reportMonth.innerText(), originalMonth);
    await workspace.goto(`${workspaceUrl}/settings`, {
      waitUntil: "networkidle",
    });
    await workspace
      .getByRole("button", { name: "Invite member", exact: true })
      .click();
    await workspace
      .getByRole("heading", { name: "Invite a member", exact: true })
      .waitFor();
    await snap(workspace, "member-invite-form", width);
    await workspace.getByRole("button", { name: "Close dialog", exact: true }).click();
    await workspace.getByRole("heading", { name: "Invite a member", exact: true }).waitFor({ state: "hidden" });
    const memberRow = workspace
      .getByRole("row")
      .filter({ hasText: "Grace Ndlovu" });
    assert.equal(await memberRow.count(), 1, "Seed member row is present");
    await memberRow
      .getByRole("combobox", { name: "Edit Grace Ndlovu duty", exact: true })
      .click();
    const dutyEditor = workspace.getByRole("combobox", {
      name: "Search Grace Ndlovu duty",
      exact: true,
    });
    const originalDuty = await memberRow.locator("td[data-label='Duty']").innerText();
    const changedDuty = `${originalDuty} UI ${width}`;
    await dutyEditor.fill(changedDuty);
    await dutyEditor.press("ArrowDown");
    await dutyEditor.press("Enter");
    await memberRow.getByText(changedDuty, { exact: true }).waitFor();
    await workspace.reload({ waitUntil: "networkidle" });
    const persistedMemberRow = workspace
      .getByRole("row")
      .filter({ hasText: "Grace Ndlovu" });
    await persistedMemberRow.getByText(changedDuty, { exact: true }).waitFor();
    await persistedMemberRow
      .getByRole("combobox", { name: "Edit Grace Ndlovu duty", exact: true })
      .click();
    const restoreDuty = workspace.getByRole("combobox", {
      name: "Search Grace Ndlovu duty",
      exact: true,
    });
    await restoreDuty.fill(originalDuty);
    await workspace.getByRole("option", { name: originalDuty, exact: true }).click();
    await persistedMemberRow.getByText(originalDuty, { exact: true }).waitFor();

    await workspace.goto(`${workspaceUrl}/settings#departments`, {
      waitUntil: "networkidle",
    });
    await workspace.getByRole("button", { name: "New department", exact: true }).waitFor();
    const departmentHeaders = (await workspace.locator(".department-table thead th").allTextContents()).map((value) => value.trim()).filter(Boolean);
    assert.deepEqual(departmentHeaders, ["Department", "Groups", "Color"]);
    assert.equal(await workspace.locator(".department-table thead").getByRole("checkbox").count(), 1, "Departments expose reusable table selection");
    const designRow = workspace
      .locator(".department-table tbody tr")
      .filter({ has: workspace.getByRole("combobox", { name: "Edit Design groups", exact: true }) });
    const departmentName = workspace.getByRole("textbox", { name: "Design department name", exact: true });
    assert.equal(await departmentName.innerText(), "Design");
    await departmentName.fill("Discarded Design rename");
    await departmentName.press("Escape");
    assert.equal(await departmentName.innerText(), "Design", "Department names edit inline and Escape restores the value");

    const testGroup = `UI ${width} ${Date.now()}`;
    const groups = designRow.getByRole("combobox", { name: "Edit Design groups", exact: true });
    await groups.click();
    assert.equal(await workspace.locator(".modal-panel[data-side]").count(), 0, "Groups edit in a compact popup, not a drawer");
    await workspace.getByRole("combobox", { name: "Search Design groups", exact: true }).fill(testGroup);
    await workspace.getByRole("option", { name: "Create new group", exact: true }).click();
    await groups.getByText(testGroup, { exact: true }).waitFor();
    await workspace.getByRole("option", { name: testGroup, exact: true }).click();
    const deleteGroupDialog = workspace.getByRole("dialog", { name: "Delete group?" });
    await deleteGroupDialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await groups.getByText(testGroup, { exact: true }).waitFor();
    await groups.click();
    await workspace.getByRole("option", { name: testGroup, exact: true }).click();
    await deleteGroupDialog.getByRole("button", { name: "Delete group", exact: true }).click();
    await deleteGroupDialog.waitFor({ state: "detached" });
    assert.equal(await groups.getByText(testGroup, { exact: true }).count(), 0);
    assert.deepEqual(errors, [], "No uncaught browser errors");
    console.log(
      `PASS ${width}px: validation → request → private code → pending edit → approval → task completion → public tracking; filters, calendar, CSV and member invitation form`,
    );
    await context.unrouteAll({ behavior: "wait" });
    await context.close();
  }

  const leaderContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const login = await leaderContext.request.post(
    `${isolated.url}/api/auth/demo`,
    {
      headers: { Origin: new URL(workspaceUrl).origin },
      data: { department: "sound" },
    },
  );
  assert.ok(login.ok(), "Department leader demo session opens");
  await routeUiTestApi(leaderContext, clientApiUrl, isolated.url);
  const leader = await leaderContext.newPage();
  await leader.goto(`${workspaceUrl}/`, { waitUntil: "networkidle" });
  assert.equal(
    await leader.getByRole("link", { name: "Requests", exact: true }).count(),
    0,
  );
  assert.equal(
    await leader.getByRole("link", { name: "Reports", exact: true }).count(),
    0,
  );
  await leader.goto(`${workspaceUrl}/requests`, { waitUntil: "networkidle" });
  await leader.getByRole("heading", { name: /Requests are .*Cell 0/ }).waitFor();
  assert.equal(await leader.getByRole("button", { name: "Request options", exact: true }).count(), 0);
  const leaderState = await leader.evaluate(async (api) => fetch(api + "/api/workspace").then((response) => response.json()), clientApiUrl);
  assert.deepEqual(leaderState.requests, [], "Non-Cell 0 API responses omit requests");
  assert.equal(
    await leader.locator(".request-list").count(),
    0,
    "Department leaders cannot access the private request inbox",
  );
  await leader.goto(`${workspaceUrl}/departments/design`, {
    waitUntil: "networkidle",
  });
  assert.equal(
    await leader
      .getByRole("button", { name: "New internal task", exact: true })
      .count(),
    0,
  );
  await leader.locator(".task-card-open").first().click();
  assert.equal(
    await leader.getByRole("button", { name: /^(Move to pending|In progress|Complete)$/, exact: true }).count(),
    0,
  );
  await snap(leader, "department-view-only", 1440);
  await leader.goto(`${workspaceUrl}/departments/cell-0`, {
    waitUntil: "networkidle",
  });
  await leader
    .getByRole("heading", { name: "This department is private", exact: true })
    .waitFor();
  await snap(leader, "private-department-gate", 1440);
  await leaderContext.unrouteAll({ behavior: "wait" });
  await leaderContext.close();
  console.log(
    "PASS department leader: request inbox and reporting hidden, other team view-only, Cell 0 private",
  );
} finally {
  await browser?.close();
  await isolated.stop();
}
