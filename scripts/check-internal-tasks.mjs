import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { startUiTestApi, routeUiTestApi } from "./ui-test-server.mjs";

const workspaceUrl = process.env.WORKSPACE_URL || "http://localhost:5173";
const clientApiUrl = process.env.API_URL || "http://localhost:3001";
const origin = new URL(workspaceUrl).origin;
const output = process.env.UI_FLOW_OUT || ".shots/internal-tasks";
const isolated = await startUiTestApi([origin]);
const testApiUrl = new URL(isolated.url);
testApiUrl.hostname = new URL(clientApiUrl).hostname;
await mkdir(output, { recursive: true });
let browser;

async function openSession(department, width) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
  const login = await context.request.post(`${testApiUrl.origin}/api/auth/demo`, {
    headers: { origin }, data: { department },
  });
  assert.ok(login.ok());
  await routeUiTestApi(context, clientApiUrl, testApiUrl.origin);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return { context, page, errors };
}

async function snap(page, name, width) {
  await page.evaluate(async () => { await document.fonts.ready; });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name}: no page overflow at ${width}px`);
  await page.screenshot({ path: `${output}/${width}-${name}.png`, fullPage: true, animations: "disabled" });
}

try {
  browser = await chromium.launch(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {});
  for (const width of [1440, 834, 390, 320]) {
    const leader = await openSession("sound", width);
    const admin = await openSession("cell-0", width);
    try {
      const page = leader.page;
      await page.goto(`${workspaceUrl}/departments/sound`);
      const createButton = page.getByRole("button", { name: "New internal task", exact: true });
      await createButton.waitFor();
      await snap(page, "leader-board", width);
      await createButton.click();
      const dialog = page.getByRole("dialog", { name: "Create internal task", exact: true });
      await dialog.waitFor();
      const title = `Leader internal task ${width}`;
      await dialog.getByPlaceholder("e.g. Prepare Sunday service graphics").fill(title);
      const due = new Date(Date.now() + 7 * 86400000);
      due.setMinutes(due.getMinutes() - due.getTimezoneOffset());
      await dialog.locator('input[type="datetime-local"]').fill(due.toISOString().slice(0, 16));
      await dialog.getByPlaceholder("What needs to be delivered?").fill("Prepare a sound check for Sunday.");
      await dialog.getByPlaceholder("Context and coordination details").fill("Coordinate with the department.");
      await snap(page, "leader-create", width);
      if (width === 1440) {
        await page.route(`${clientApiUrl}/api/actions`, (route) => route.fulfill({
          status: 503, contentType: "application/json", body: JSON.stringify({ error: "Temporary save failure. Try again." }),
        }), { times: 1 });
        await dialog.getByRole("button", { name: "Create task", exact: true }).click();
        await dialog.getByRole("alert").getByText("Temporary save failure. Try again.").waitFor();
        assert.equal(await dialog.getByPlaceholder("e.g. Prepare Sunday service graphics").inputValue(), title);
      }
      await dialog.getByRole("button", { name: "Create task", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      await page.getByRole("button", { name: `Open ${title}`, exact: true }).waitFor();
      await page.reload();
      await page.getByRole("button", { name: `Open ${title}`, exact: true }).waitFor();
      await snap(page, "leader-created", width);

      await page.goto(`${workspaceUrl}/departments/design`);
      await page.getByRole("heading", { name: "Design", exact: true }).waitFor();
      assert.equal(await page.getByRole("button", { name: "New internal task", exact: true }).count(), 0);

      await admin.page.goto(`${workspaceUrl}/settings`);
      await admin.page.getByRole("columnheader", { name: "Sign-in enabled", exact: true }).waitFor();
      await admin.page.getByText(/Sign-in enabled lets a member enter the workspace/).waitFor();
      const row = admin.page.getByRole("row").filter({ hasText: "Grace Ndlovu" });
      const leaderSwitch = row.getByRole("switch", { name: "Grace Ndlovu leader role", exact: true });
      await leaderSwitch.focus();
      await leaderSwitch.press("Space");
      await admin.page.waitForFunction(() => document.querySelector('[role="switch"][aria-label="Grace Ndlovu leader role"]')?.getAttribute("aria-checked") === "false");
      await page.goto(`${workspaceUrl}/departments/sound`);
      await page.getByRole("heading", { name: "Sound", exact: true }).waitFor();
      assert.equal(await page.getByRole("button", { name: "New internal task", exact: true }).count(), 0, "Members cannot create internal tasks");
      await leaderSwitch.locator("..").click();
      await admin.page.waitForFunction(() => document.querySelector('[role="switch"][aria-label="Grace Ndlovu leader role"]')?.getAttribute("aria-checked") === "true");
      const signIn = row.getByRole("switch", { name: "Grace Ndlovu sign-in enabled", exact: true });
      await signIn.locator("..").click();
      await admin.page.waitForFunction(() => document.querySelector('[role="switch"][aria-label="Grace Ndlovu sign-in enabled"]')?.getAttribute("aria-checked") === "false");
      await admin.page.reload();
      await signIn.waitFor();
      assert.equal(await signIn.getAttribute("aria-checked"), "false", "Sign-in approval persists separately from leadership");
      assert.equal(await leaderSwitch.getAttribute("aria-checked"), "true");
      await signIn.locator("..").click();
      await admin.page.waitForFunction(() => document.querySelector('[role="switch"][aria-label="Grace Ndlovu sign-in enabled"]')?.getAttribute("aria-checked") === "true");
      await signIn.scrollIntoViewIfNeeded();
      await snap(admin.page, "member-sign-in", width);
      await admin.page.getByRole("button", { name: "Invite member", exact: true }).click();
      const invite = admin.page.getByRole("dialog", { name: "Invite a member", exact: true });
      await invite.getByText("Leaders can create internal tasks in their department and manage request options.").waitFor();
      await snap(admin.page, "invite-leader-help", width);
      await invite.getByRole("button", { name: "Cancel", exact: true }).click();
      assert.deepEqual([...leader.errors, ...admin.errors], []);
      console.log(`PASS ${width}px: department leader create/reload, other department denied, member denied, sign-in approval and leader role independent, invitation guidance`);
    } catch (error) {
      console.error("Leader page:", await leader.page.locator("body").innerText(), "Browser errors:", leader.errors);
      await leader.page.screenshot({ path: `${output}/${width}-failure.png`, fullPage: true });
      throw error;
    } finally {
      await leader.context.close();
      await admin.context.close();
    }
  }
} finally {
  await browser?.close();
  await isolated.stop();
}
