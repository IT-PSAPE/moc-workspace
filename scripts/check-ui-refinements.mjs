import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { startUiTestApi, routeUiTestApi } from "./ui-test-server.mjs";

const origin = "http://localhost:5173";
const api = await startUiTestApi([origin]);
const browser = await chromium.launch();
const output = "output/playwright";
await mkdir(output, { recursive: true });
try {
  for (const width of [1337, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 954 },
      timezoneId: "Africa/Johannesburg",
      hasTouch: width === 390,
    });
    await routeUiTestApi(context, "http://localhost:3001", api.url);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const shot = async (name, locator) => {
      await locator.scrollIntoViewIfNeeded();
      await locator.screenshot({
        path: `${output}/${name}-${width}.png`,
        animations: "disabled",
      });
    };
    const noOverflow = async () =>
      assert.equal(
        await page.evaluate(() =>
          [
            ...document.querySelectorAll(
              ".main-panel, .page-content, .modal-panel",
            ),
          ].some((node) => node.scrollWidth > node.clientWidth + 1),
        ),
        false,
        "No horizontal overflow",
      );
    await page.goto(origin, { waitUntil: "networkidle" });
    const canvas = page.locator("canvas.dashboard-pulse-chart");
    await canvas.waitFor();
    assert.equal(await page.locator("svg.dashboard-pulse-chart").count(), 0);
    await canvas.focus();
    await canvas.press("Home");
    assert.match(
      await page.locator(".dashboard-pulse [role=status]").innerText(),
      /0 tasks completed/,
    );
    await canvas.press("End");
    assert.match(
      await page.locator(".dashboard-pulse [role=status]").innerText(),
      /4 tasks completed/,
    );
    await shot("pulse-chart", page.locator(".dashboard-pulse"));
    // A response-only fixture proves that values above the old cap are plotted
    // accurately. It never modifies the isolated API or the running demo.
    await context.route("**/api/workspace", async (route) => {
      const response = await route.fetch({ url: `${api.url}/api/workspace` });
      const state = await response.json();
      const now = new Date();
      const counts = [0, 1, 4, 18, 2, 0, 3, 7];
      state.tasks = counts.flatMap((count, index) =>
        Array.from({ length: count }, (_, taskIndex) => ({
          ...state.tasks[0],
          id: `chart-${index}-${taskIndex}`,
          status: "completed",
          progress: 100,
          completedAt: new Date(
            now.getFullYear(),
            now.getMonth() - 7 + index,
            10,
            12,
          ).toISOString(),
        })),
      );
      await route.fulfill({ response, json: state });
    });
    await page.reload({ waitUntil: "networkidle" });
    await canvas.waitFor();
    const chartState = await page.evaluate(async () => {
      const moduleUrl = performance
        .getEntriesByType("resource")
        .map((entry) => entry.name)
        .find((name) => /\/chart__?js\.js/.test(name));
      if (!moduleUrl) throw new Error("Chart.js module not found");
      const { Chart } = await import(moduleUrl);
      const chart = Chart.getChart(
        document.querySelector("canvas.dashboard-pulse-chart"),
      );
      const points = chart.getDatasetMeta(0).data;
      return {
        values: chart.data.datasets[0].data,
        min: chart.scales.y.min,
        max: chart.scales.y.max,
        top: chart.chartArea.top,
        bottom: chart.chartArea.bottom,
        yZero: points[0].y,
        yPeak: points[3].y,
        xPeak: points[3].x,
      };
    });
    assert.deepEqual(chartState.values, [0, 1, 4, 18, 2, 0, 3, 7]);
    assert.equal(chartState.min, 0);
    assert.ok(chartState.max >= 18);
    assert.equal(chartState.yZero, chartState.bottom);
    assert.ok(
      chartState.yPeak >= chartState.top && chartState.yPeak < chartState.yZero,
    );
    await canvas.focus();
    await canvas.press("Home");
    await canvas.press("ArrowRight");
    await canvas.press("ArrowRight");
    await canvas.press("ArrowRight");
    assert.match(
      await page.locator(".dashboard-pulse [role=status]").innerText(),
      /18 tasks completed/,
    );
    await canvas.blur();
    const position = { x: chartState.xPeak, y: chartState.yPeak };
    if (width === 390) await canvas.tap({ position });
    else {
      const bounds = await canvas.boundingBox();
      await page.mouse.move(bounds.x + position.x, bounds.y + position.y);
    }
    await page.waitForFunction(async () => {
      const moduleUrl = performance
        .getEntriesByType("resource")
        .map((entry) => entry.name)
        .find((name) => /\/chart__?js\.js/.test(name));
      const { Chart } = await import(moduleUrl);
      return (
        Chart.getChart(document.querySelector("canvas.dashboard-pulse-chart"))
          .tooltip.opacity === 1
      );
    });
    await shot("pulse-chart-range", page.locator(".dashboard-pulse"));
    await context.unroute("**/api/workspace");
    await page.goto(`${origin}/calendar`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Next month", exact: true }).click();
    await page
      .getByRole("button", { name: "Previous month", exact: true })
      .click();
    await page.getByRole("button", { name: "Today", exact: true }).click();
    const allScheduleEvents = await page
      .locator(".schedule-month .schedule-event")
      .count();
    await page.getByRole("button", { name: /^Filters/ }).click();
    const departmentFilter = page.getByRole("combobox", {
      name: "Filter work by department",
      exact: true,
    });
    const scheduleStatus = page.getByRole("combobox", {
      name: "Filter work by status",
      exact: true,
    });
    assert.equal(await departmentFilter.inputValue(), "all");
    assert.equal(await scheduleStatus.inputValue(), "all");
    await page
      .getByRole("combobox", { name: "Filter work by status", exact: true })
      .selectOption("completed");
    assert.equal(
      await page.locator(".schedule-month .schedule-event").count(),
      4,
    );
    await departmentFilter.selectOption("sound");
    const soundEvents = page.locator('.schedule-month .schedule-event[data-dept="sound"]');
    const visibleScheduleEvents = await page
      .locator(".schedule-month .schedule-event")
      .count();
    assert.ok(visibleScheduleEvents > 0 && (await soundEvents.count()) === visibleScheduleEvents);
    await page
      .getByRole("button", { name: "Reset filters", exact: true })
      .click();
    assert.equal(await departmentFilter.inputValue(), "all");
    assert.equal(await scheduleStatus.inputValue(), "all");
    assert.equal(
      await page.locator(".schedule-month .schedule-event").count(),
      allScheduleEvents,
    );
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.screenshot({ path: `${output}/schedule-${width}.png` });
    await noOverflow();
    if (width === 390) {
      await page
        .locator(".schedule-day")
        .filter({ has: page.locator(".schedule-event") })
        .first()
        .locator(".schedule-day-number")
        .click();
      await page.getByRole("dialog").locator(".calendar-task").first().click();
    } else await page.locator(".calendar-task").first().click();
    await page
      .getByRole("heading", { name: "Deadline details", exact: true })
      .waitFor();
    await shot("task-overview", page.getByRole("dialog"));
    await page.getByRole("button", { name: /^Comments/ }).click();
    await page
      .getByRole("textbox", { name: "Add a comment", exact: true })
      .fill(`Calendar comment at ${width}px`);
    await page
      .getByRole("button", { name: "Post comment", exact: true })
      .click();
    await page
      .getByText(`Calendar comment at ${width}px`, { exact: true })
      .waitFor();
    await shot("task-comments", page.getByRole("dialog"));
    await noOverflow();
    await page
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "Search work", exact: true })
      .fill("no-result-work");
    await page.getByText(/No deadlines this month match your search/).waitFor();
    await page
      .getByRole("textbox", { name: "Search work", exact: true })
      .fill("");
    for (const view of ["week", "day", "agenda"]) {
      await page
        .getByRole("combobox", { name: "Calendar view", exact: true })
        .selectOption(view);
      await page.screenshot({
        path: `${output}/schedule-${view}-${width}.png`,
      });
      await noOverflow();
    }
    await page.goto(`${origin}/reports`, { waitUntil: "networkidle" });
    await shot("report-cards", page.locator(".report-metrics"));
    await noOverflow();
    await page.goto(`${origin}/requests`, { waitUntil: "networkidle" });
    await page.locator(".request-row").first().click();
    await page
      .getByRole("heading", { name: "Request details", exact: true })
      .waitFor();
    await shot("request-overview", page.getByRole("dialog"));
    await page
      .getByRole("textbox", { name: "Add a comment", exact: true })
      .fill(`Request comment at ${width}px`);
    await page
      .getByRole("button", { name: "Post comment", exact: true })
      .click();
    await page
      .getByText(`Request comment at ${width}px`, { exact: true })
      .waitFor();
    await shot("request-comments", page.getByRole("dialog"));
    await page
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await page.reload({ waitUntil: "networkidle" });
    await page.locator(".request-row").first().click();
    await page
      .getByText(`Request comment at ${width}px`, { exact: true })
      .waitFor();
    await noOverflow();
    assert.deepEqual(errors, []);
    console.log(
      `PASS ${width}px: canvas scale, zero and 18+ counts, keyboard tooltips, calendar navigation/views/search, detail comments, persistence, report cards, no browser errors or horizontal overflow`,
    );
    await context.close();
  }
} finally {
  await browser.close();
  await api.stop();
}
