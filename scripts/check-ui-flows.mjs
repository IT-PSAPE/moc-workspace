import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
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
const output = ".shots/flows";
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
try {
  browser = await chromium.launch();
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
    const requestFilter = workspace.getByRole("button", { name: /^Filters/ });
    await requestFilter.click();
    const requestStatus = workspace.getByRole("combobox", {
      name: "Filter requests by status",
      exact: true,
    });
    assert.equal(await requestStatus.inputValue(), "pending");
    const pendingRequestCount = await workspace.locator(".request-row").count();
    assert.ok(pendingRequestCount > 0, "Default request filter shows pending work");
    await workspace
      .getByRole("button", { name: "Reset filters", exact: true })
      .click();
    assert.equal(await requestStatus.inputValue(), "all");
    await workspace.getByRole("button", { name: "Done", exact: true }).click();
    assert.ok(
      (await workspace.locator(".request-row").count()) >= pendingRequestCount,
      "Resetting request filters restores all statuses",
    );
    await workspace
      .locator(".request-row")
      .filter({ hasText: editedTitle })
      .click();
    await workspace
      .getByRole("heading", { name: "Request details", exact: true })
      .waitFor();
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
    await workspace.getByRole("button", { name: "100%", exact: true }).click();
    await workspace.locator(".modal-panel").waitFor({ state: "hidden" });
    await workspace
      .getByRole("button", { name: `Open ${editedTitle}`, exact: true })
      .click();
    await workspace.getByRole("button", { name: /^Comments/ }).click();
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
    await workspace.getByRole("button", { name: /^Comments/ }).click();
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
      .getByRole("heading", { name: "Deadline details", exact: true })
      .waitFor();
    await snap(workspace, "calendar-detail", width);
    await workspace.goto(`${workspaceUrl}/reports`, {
      waitUntil: "networkidle",
    });
    const downloadPromise = workspace.waitForEvent("download");
    await workspace.getByRole("button", { name: /Export/ }).click();
    const download = await downloadPromise;
    assert.match(download.suggestedFilename(), /\.csv$/);
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
    const memberRow = workspace
      .locator(".members-row")
      .filter({ hasText: "Grace Ndlovu" });
    assert.equal(await memberRow.count(), 1, "Seed member row is present");
    await memberRow
      .getByRole("button", { name: "Edit Grace Ndlovu duty", exact: true })
      .click();
    const dutyEditor = memberRow.getByRole("textbox", {
      name: "Duty for Grace Ndlovu",
      exact: true,
    });
    const originalDuty = await dutyEditor.inputValue();
    const changedDuty = `${originalDuty} UI ${width}`;
    await dutyEditor.fill(changedDuty);
    await memberRow
      .getByRole("button", { name: "Save Grace Ndlovu duty", exact: true })
      .click();
    await memberRow.getByText(changedDuty, { exact: true }).waitFor();
    await workspace.reload({ waitUntil: "networkidle" });
    const persistedMemberRow = workspace
      .locator(".members-row")
      .filter({ hasText: "Grace Ndlovu" });
    await persistedMemberRow.getByText(changedDuty, { exact: true }).waitFor();
    await persistedMemberRow
      .getByRole("button", { name: "Edit Grace Ndlovu duty", exact: true })
      .click();
    await persistedMemberRow
      .getByRole("textbox", { name: "Duty for Grace Ndlovu", exact: true })
      .fill(originalDuty);
    await persistedMemberRow
      .getByRole("button", { name: "Save Grace Ndlovu duty", exact: true })
      .click();
    await persistedMemberRow.getByText(originalDuty, { exact: true }).waitFor();

    await workspace.goto(`${workspaceUrl}/settings#departments`, {
      waitUntil: "networkidle",
    });
    await workspace.getByRole("button", { name: "New department", exact: true }).waitFor();
    const designRow = workspace
      .locator(".department-table tbody tr")
      .filter({ hasText: "Design" })
      .first();
    await designRow.getByRole("button", { name: "Actions for Design" }).click();
    await workspace.getByRole("menuitem", { name: "Rename", exact: true }).click();
    const departmentName = workspace.getByLabel("Department name", { exact: true });
    assert.equal(await departmentName.inputValue(), "Design");
    await workspace.getByRole("button", { name: "Cancel", exact: true }).click();

    const testGroup = `UI ${width} ${Date.now()}`;
    await designRow.getByRole("button", { name: /Manage .* groups for Design/ }).click();
    const groupDrawer = workspace.getByRole("dialog", { name: "Design groups" });
    await groupDrawer.getByRole("button", { name: "Add group", exact: true }).click();
    await workspace.getByLabel("Group name", { exact: true }).fill(testGroup);
    await workspace.getByRole("button", { name: "Save group", exact: true }).click();
    let groupRow = groupDrawer.getByRole("row").filter({ hasText: testGroup });
    await groupRow.waitFor();
    await groupRow.getByRole("button", { name: `Actions for ${testGroup}` }).click();
    await workspace.getByRole("menuitem", { name: "Rename", exact: true }).click();
    const renamedGroup = `${testGroup} renamed`;
    await workspace.getByLabel("Group name", { exact: true }).fill(renamedGroup);
    await workspace.getByRole("button", { name: "Save group", exact: true }).click();
    groupRow = groupDrawer.getByRole("row").filter({ hasText: renamedGroup });
    await groupRow.waitFor();
    await groupRow.getByRole("button", { name: `Actions for ${renamedGroup}` }).click();
    await workspace.getByRole("menuitem", { name: "Delete", exact: true }).click();
    const deleteGroupDialog = workspace.getByRole("dialog", { name: "Delete group?" });
    await deleteGroupDialog.getByRole("button", { name: "Delete group", exact: true }).click();
    await groupRow.waitFor({ state: "detached" });
    assert.deepEqual(errors, [], "No uncaught browser errors");
    console.log(
      `PASS ${width}px: validation → request → private code → pending edit → approval → task completion → public tracking; filters, calendar, CSV and member invitation form`,
    );
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
    1,
  );
  assert.equal(
    await leader.getByRole("link", { name: "Reports", exact: true }).count(),
    0,
  );
  await leader.goto(`${workspaceUrl}/requests`, { waitUntil: "networkidle" });
  await leader
    .getByRole("button", { name: "Request options", exact: true })
    .waitFor();
  assert.equal(
    await leader.locator(".request-list").count(),
    0,
    "Department leaders manage catalog without receiving the private request inbox",
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
    await leader.getByRole("button", { name: "25%", exact: true }).count(),
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
  await leaderContext.close();
  console.log(
    "PASS department leader: request setup available, private reporting hidden, other team view-only, Cell 0 private",
  );
} finally {
  await browser?.close();
  await isolated.stop();
}
