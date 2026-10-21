#!/usr/bin/env node
/**
 * Visual verification harness for the MOC Workspace monorepo.
 *
 * Captures every screen, component and interaction state of the workspace
 * app (http://localhost:5173) and the portal app (http://localhost:5174)
 * at four viewports, writing PNGs to `.shots/<viewport>/<state>.png`.
 *
 * Requires the workspace and portal dev servers already running. API calls
 * are routed to a fresh isolated UI-test API for every run.
 *
 * Usage:
 *   node scripts/shoot.mjs                     # full run, clears .shots/ first
 *   node scripts/shoot.mjs --only=calendar      # only states whose name contains "calendar"
 *   node scripts/shoot.mjs --viewport=phone     # only the phone viewport
 *   node scripts/shoot.mjs --only=dashboard --viewport=desktop
 *
 * When --only or --viewport is passed, the output directory is NOT wiped
 * (so a fast single-state re-shot doesn't destroy the rest of the gallery).
 */

import { chromium } from "playwright";
import { startUiTestApi, routeUiTestApi } from "./ui-test-server.mjs";
import {
  mkdirSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SHOTS_DIR = path.join(ROOT, ".shots");

const WORKSPACE_URL = process.env.WORKSPACE_URL || "http://localhost:5173";
const PORTAL_URL = process.env.PORTAL_URL || "http://localhost:5174";
const CLIENT_API_URL = process.env.API_URL || "http://localhost:3001";
let API_URL = CLIENT_API_URL;

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 834, height: 1112 },
  { name: "phone", width: 390, height: 844 },
  { name: "phone-small", width: 320, height: 740 },
];

const args = process.argv.slice(2);
const onlyArg = args
  .find((a) => a.startsWith("--only="))
  ?.slice("--only=".length);
const viewportArg = args
  .find((a) => a.startsWith("--viewport="))
  ?.slice("--viewport=".length);
const isFiltered = Boolean(onlyArg || viewportArg);

function log(...a) {
  console.log(...a);
}

// Playwright route handlers run detached from the awaiting call site; a
// request that races a navigation/unroute can reject after the handler has
// otherwise finished (e.g. "Route is already handled"). Handlers already
// catch their own continue()/fulfill() calls, but this is a last-resort net
// so a stray rejection never takes down the whole multi-hour run.
process.on("unhandledRejection", (reason) => {
  console.error(
    "WARN unhandledRejection (ignored):",
    reason?.message || reason,
  );
});

// ---------------------------------------------------------------------------
// Determinism helpers
// ---------------------------------------------------------------------------

const FREEZE_CSS = `
*, *::before, *::after {
  animation-duration: 0.001ms !important;
  animation-delay: -0.001ms !important;
  animation-iteration-count: 1 !important;
  transition-duration: 0.001ms !important;
  transition-delay: 0s !important;
  scroll-behavior: auto !important;
}
input, textarea, [contenteditable] { caret-color: transparent !important; }
`;

async function installFreeze(context) {
  await context.addInitScript((css) => {
    const apply = () => {
      if (!document.head) {
        requestAnimationFrame(apply);
        return;
      }
      const style = document.createElement("style");
      style.setAttribute("data-shoot-freeze", "true");
      style.textContent = css;
      document.head.appendChild(style);
    };
    apply();
  }, FREEZE_CSS);
}

async function settle(page) {
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  try {
    await page.evaluate(async () => {
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
    });
  } catch {
    // ignore - fonts API not available or page navigating
  }
  await page.waitForLoadState("networkidle", { timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(200);
}

function outPath(vpName, name) {
  return path.join(SHOTS_DIR, vpName, `${name}.png`);
}

async function shoot(page, vpName, name, opts = {}) {
  const { clip = null, fullPage = true } = opts;
  const overflowing = await page.evaluate(() =>
    [
      document.documentElement,
      ...document.querySelectorAll(".main-panel"),
    ].some((element) => element.scrollWidth > element.clientWidth + 1),
  );
  if (overflowing)
    throw new Error(`${name}: content exceeds the viewport width`);
  const file = outPath(vpName, name);
  mkdirSync(path.dirname(file), { recursive: true });
  if (clip) {
    const locator =
      typeof clip === "string" ? page.locator(clip).first() : clip;
    await locator.waitFor({ state: "visible", timeout: 5000 });
    await locator.scrollIntoViewIfNeeded().catch(() => {});
    await locator.screenshot({ path: file });
  } else {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: file, fullPage, animations: "disabled" });
  }
}

// ---------------------------------------------------------------------------
// Session helper: keeps one page signed in/out across states, re-navigating
// fresh for every state so local React state never leaks between captures.
// ---------------------------------------------------------------------------

class Session {
  constructor(page, context) {
    this.page = page;
    this.context = context;
    this.signedIn = false;
  }
  async ensureSignedIn() {
    if (this.signedIn) return;
    await this.page.goto(`${WORKSPACE_URL}/`, { waitUntil: "load" });
    await this.page.waitForSelector(".workspace-shell", { timeout: 20000 });
    this.signedIn = true;
  }
  async ensureSignedOut(routePath = "/login") {
    await this.context.clearCookies();
    this.signedIn = false;
    await this.page.goto(`${WORKSPACE_URL}${routePath}`, { waitUntil: "load" });
    await this.page.waitForSelector(".access-card", { timeout: 20000 });
  }
  /** Ensures a valid demo session, then navigates (fresh, full reload) to routePath. */
  async gotoWorkspace(routePath) {
    await this.ensureSignedIn();
    await this.page.goto(`${WORKSPACE_URL}${routePath}`, { waitUntil: "load" });
    await settle(this.page);
  }
}

// ---------------------------------------------------------------------------
// Portal helpers
// ---------------------------------------------------------------------------

async function selectPortalTab(page, label) {
  await page
    .getByRole("button", {
      name: label.startsWith("Track") ? /Track a submission/ : /Make a request/,
    })
    .click();
}

async function openPortalRequest(page) {
  await page.goto(PORTAL_URL, { waitUntil: "load" });
  await selectPortalTab(page, "Make");
  await page.waitForSelector(".request-form");
}

function localDateTimeInput(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

async function fillPortalRequestForm(
  page,
  { shortNotice = false, review = true } = {},
) {
  await page.locator("select#service").selectOption({ index: 1 });
  await page.locator("select#ministry").selectOption({ index: 1 });
  await page.fill(
    '.request-form input[placeholder="e.g. Youth retreat recap video"]',
    "Visual QA harness sample request",
  );
  await page.fill(
    '.request-form textarea[placeholder="Describe what you need…"]',
    "Please prepare the requested materials ahead of the scheduled service.",
  );
  await page.fill(
    '.request-form textarea[placeholder="Anything else we should know?"]',
    "Screenshot fixture in the isolated UI test API.",
  );
  if (await page.locator(".aired-dates-block").count()) {
    const dates = page.locator(".aired-date-row input[type='date']");
    if ((await dates.count()) === 0) await page.click(".add-date");
    await dates.first().fill(new Date().toISOString().slice(0, 10));
  }
  const target = new Date(
    Date.now() + (shortNotice ? 3 : 7 * 24) * 3600 * 1000,
  );
  await page.fill(
    '.request-form input[type="datetime-local"]',
    localDateTimeInput(target),
  );
  if (review)
    await page.getByRole("button", { name: "Next", exact: true }).click();
}

/** Creates a throwaway public request directly against the API so the
 * portal "track: found request" state has a valid tracking code to use,
 * independent of whether the UI submission state ran first. */
async function createDemoTrackingCode() {
  const catalog = await fetch(`${API_URL}/api/catalog`).then((r) => r.json());
  const service =
    catalog.services.find((s) => !s.requiresAiredDates) || catalog.services[0];
  const ministry = catalog.ministries[0];
  const dueAt = new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString();
  const res = await fetch(`${API_URL}/api/requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: PORTAL_URL },
    body: JSON.stringify({
      ministry,
      service: service.id,
      title: "Visual QA harness tracking sample",
      instructions:
        "Generated automatically by scripts/shoot.mjs for screenshot verification.",
      notes: "Safe to ignore.",
      dueAt,
      airedDates: [],
    }),
  });
  if (!res.ok) {
    throw new Error(
      `Failed to pre-create a demo request for tracking (status ${res.status})`,
    );
  }
  const data = await res.json();
  return data.trackingCode;
}

// ---------------------------------------------------------------------------
// State registry
// ---------------------------------------------------------------------------

function buildStates(sharedTrackingCode) {
  const states = [];
  const add = (name, group, fn, opts = {}) =>
    states.push({ name, group, fn, viewports: opts.viewports || null });

  // ---- Auth / signed-out / error states (destructive: touch cookies/routes) ----

  add("auth-loading", "auth", async ({ page, context, session, vp }) => {
    await context.clearCookies();
    const handler = async (route) => {
      await new Promise((r) => setTimeout(r, 2500));
      await route.continue().catch(() => {});
    };
    await page.route("**/api/session", handler);
    try {
      const nav = page.goto(`${WORKSPACE_URL}/`, { waitUntil: "load" });
      await page.getByText(/Preparing your workspace/i).waitFor({
        state: "visible",
        timeout: 10000,
      });
      await page.waitForTimeout(150);
      await shoot(page, vp, "auth-loading");
      await nav;
    } finally {
      await page.unroute("**/api/session", handler).catch(() => {});
    }
    session.signedIn = false;
  });

  add("auth-signed-out", "auth", async ({ page, session, vp }) => {
    await session.ensureSignedOut("/login");
    await page
      .getByRole("link", { name: /Continue with Google/i })
      .waitFor({ state: "visible", timeout: 15000 });
    await settle(page);
    await shoot(page, vp, "auth-signed-out");
  });

  add("auth-login-error", "auth", async ({ page, context, session, vp }) => {
    await context.clearCookies();
    session.signedIn = false;
    const handler = (route) =>
      route
        .fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "Simulated outage for visual QA." }),
        })
        .catch(() => {});
    await page.route("**/api/session", handler);
    try {
      await page.goto(`${WORKSPACE_URL}/`, { waitUntil: "load" });
      await page
        .getByRole("alert")
        .waitFor({ state: "visible", timeout: 12000 });
      await settle(page);
      await shoot(page, vp, "auth-login-error");
    } finally {
      await page.unroute("**/api/session", handler).catch(() => {});
    }
    session.signedIn = false;
  });

  // ---- Shell chrome ----

  add("shell-notifications-items", "shell", async ({ page, session, vp }) => {
    await session.gotoWorkspace("/");
    await page.getByRole("button", { name: /Notifications/i }).click();
    await page
      .getByRole("heading", { name: /Notifications/i })
      .waitFor({ state: "visible", timeout: 8000 });
    await settle(page);
    await shoot(page, vp, "shell-notifications-items", {
      clip: ".modal-panel",
    });
  });

  add("shell-notifications-empty", "shell", async ({ page, session, vp }) => {
    await session.ensureSignedIn();
    const handler = async (route) => {
      try {
        const url = new URL(route.request().url());
        const response = await route.fetch({
          url: `${API_URL}${url.pathname}${url.search}`,
        });
        const json = await response.json();
        json.notifications = [];
        await route.fulfill({ response, json });
      } catch {
        await route.continue().catch(() => {});
      }
    };
    await page.route("**/api/workspace", handler);
    try {
      await page.reload({ waitUntil: "load" });
      await page.getByRole("heading", { level: 1 }).waitFor({ timeout: 15000 });
      await page.getByRole("button", { name: /Notifications/i }).click();
      await page
        .getByText(/caught up/i)
        .waitFor({ state: "visible", timeout: 8000 });
      await settle(page);
      await shoot(page, vp, "shell-notifications-empty", {
        clip: ".modal-panel",
      });
    } finally {
      await page.unroute("**/api/workspace", handler).catch(() => {});
    }
  });

  add("shell-quick-guide", "shell", async ({ page, session, vp }) => {
    await session.gotoWorkspace("/");
    // Below 680px the sidebar is replaced by the mobile menu, so the guide is
    // reached through there rather than from a sidebar entry.
    const navTrigger = page.getByRole("button", { name: /Open navigation/i });
    if (await navTrigger.isVisible().catch(() => false)) {
      await navTrigger.click();
      await page
        .getByRole("heading", { name: /MOC Workspace/i })
        .waitFor({ state: "visible", timeout: 8000 });
    }
    await page.getByRole("button", { name: /Quick guide/i }).click();
    await page
      .getByRole("heading", { name: /quick guide to MOC/i })
      .waitFor({ state: "visible", timeout: 8000 });
    await settle(page);
    await shoot(page, vp, "shell-quick-guide", { clip: ".modal-panel" });
  });

  add(
    "shell-mobile-nav-modal",
    "shell",
    async ({ page, session, vp }) => {
      await session.gotoWorkspace("/");
      await page
        .getByRole("button", { name: /Open navigation/i })
        .click({ timeout: 4000 });
      await page
        .getByRole("heading", { name: /MOC Workspace/i })
        .waitFor({ state: "visible", timeout: 8000 });
      await settle(page);
      await shoot(page, vp, "shell-mobile-nav-modal", { clip: ".modal-panel" });
    },
    { viewports: ["phone"] },
  );

  add("shell-connection-error", "shell", async ({ page, session, vp }) => {
    await session.ensureSignedIn();
    // Let the workspace load first, THEN break the connection. This is the
    // real-world shape of a connection dropping while working. Cold error
    // and retry/recovery states are covered by check-ui-state-coverage.mjs.
    await session.gotoWorkspace("/");
    await page.getByRole("heading", { level: 1 }).waitFor({ timeout: 15000 });
    await page.evaluate(() => {
      const original = window.fetch;
      window.fetch = function (input, init) {
        const url =
          typeof input === "string" ? input : (input && input.url) || "";
        if (url.includes("/api/workspace")) {
          return Promise.resolve(
            new Response(JSON.stringify({ error: "Service unavailable" }), {
              status: 503,
              headers: { "content-type": "application/json" },
            }),
          );
        }
        return original.apply(this, arguments);
      };
    });
    const alert = page.getByRole("alert").first();
    await alert.waitFor({ state: "visible", timeout: 20000 });
    await settle(page);
    await shoot(page, vp, "shell-connection-error", { clip: alert });
  });

  add("route-not-found", "shell", async ({ page, session, vp }) => {
    await session.gotoWorkspace("/does-not-exist");
    await page.waitForSelector("text=Page not found", { timeout: 8000 });
    await settle(page);
    await shoot(page, vp, "route-not-found");
  });

  add("route-invalid-department", "shell", async ({ page, session, vp }) => {
    await session.gotoWorkspace("/departments/nope");
    await page.waitForSelector("text=Department not found", { timeout: 8000 });
    await settle(page);
    await shoot(page, vp, "route-invalid-department");
  });

  // ---- Dashboard ----

  add("dashboard", "dashboard", async ({ page, session, vp }) => {
    await session.gotoWorkspace("/");
    await page.getByRole("heading", { level: 1 }).waitFor({ timeout: 15000 });
    await settle(page);
    await shoot(page, vp, "dashboard");
  });

  add(
    "dashboard-department-card-hover",
    "dashboard",
    async ({ page, session, vp }) => {
      await session.gotoWorkspace("/");
      const card = page
        .getByRole("link", { name: /Design|Sound|Visual Media/ })
        .first();
      await card.waitFor({ state: "visible", timeout: 5000 });
      await card.hover();
      await page.waitForTimeout(150);
      await shoot(page, vp, "dashboard-department-card-hover", { clip: card });
    },
  );

  add(
    "dashboard-nav-item-hover",
    "dashboard",
    async ({ page, session, vp }) => {
      await session.gotoWorkspace("/");
      const navItem = page
        .getByRole("navigation", { name: /Main navigation/i })
        .getByRole("link", { name: /Departments/i });
      await navItem.waitFor({ state: "visible", timeout: 4000 });
      await navItem.hover();
      await page.waitForTimeout(150);
      await shoot(page, vp, "dashboard-nav-item-hover", { clip: navItem });
    },
    { viewports: ["desktop", "laptop", "tablet"] },
  );

  // ---- Departments overview ----

  add("departments-overview", "departments", async ({ page, session, vp }) => {
    await session.gotoWorkspace("/departments");
    await page.getByRole("heading", { level: 1 }).waitFor({ timeout: 15000 });
    await settle(page);
    await shoot(page, vp, "departments-overview");
  });

  // ---- Department boards ----

  for (const dept of ["cell-0", "sound", "design", "visual-media"]) {
    add(
      `department-${dept}`,
      "department-board",
      async ({ page, session, vp }) => {
        await session.gotoWorkspace(`/departments/${dept}`);
        await page
          .getByRole("heading", { level: 1 })
          .waitFor({ timeout: 15000 });
        await settle(page);
        await shoot(page, vp, `department-${dept}`);
      },
    );
  }

  add(
    "department-sound-filtered",
    "department-board",
    async ({ page, session, vp }) => {
      await session.gotoWorkspace("/departments/sound");
      await page.getByRole("heading", { level: 1 }).waitFor({ timeout: 15000 });
      await page.getByRole("button", { name: /Filters/ }).click();
      const filters = page.getByRole("dialog", { name: "Filters" });
      await filters.waitFor({ state: "visible", timeout: 5000 });
      await filters
        .getByRole("combobox", { name: /Filter by status/i })
        .selectOption("in-progress");
      await settle(page);
      await shoot(page, vp, "department-sound-filtered");
    },
  );

  add(
    "department-sound-empty",
    "department-board",
    async ({ page, session, vp }) => {
      await session.gotoWorkspace("/departments/sound");
      await page.getByRole("heading", { level: 1 }).waitFor({ timeout: 15000 });
      await page
        .locator(".page-content")
        .getByRole("textbox", { name: /Search tasks/i })
        .fill("zzznonexistentxyz");
      await page
        .getByText(/No tasks match these filters/i)
        .first()
        .waitFor({ timeout: 8000 });
      await settle(page);
      await shoot(page, vp, "department-sound-empty");
    },
  );

  add(
    "department-sound-create-task",
    "department-board",
    async ({ page, session, vp }) => {
      await session.gotoWorkspace("/departments/sound");
      await page.getByRole("button", { name: /New internal task/i }).click();
      await page
        .getByRole("heading", { name: /Create internal task/i })
        .waitFor({ state: "visible", timeout: 8000 });
      await settle(page);
      await shoot(page, vp, "department-sound-create-task", {
        clip: ".modal-panel",
      });
    },
  );

  add(
    "department-sound-task-detail",
    "department-board",
    async ({ page, session, vp }) => {
      await session.gotoWorkspace("/departments/sound");
      const card = page.locator(".task-card-open").first();
      await card.waitFor({ state: "visible", timeout: 8000 });
      await card.click();
      await page
        .getByRole("heading", { name: /Task details/i })
        .waitFor({ state: "visible", timeout: 8000 });
      await settle(page);
      await shoot(page, vp, "department-sound-task-detail", {
        clip: ".modal-panel",
      });
    },
  );

  // ---- Requests ----

  add("requests-list", "requests", async ({ page, session, vp }) => {
    await session.gotoWorkspace("/requests");
    await page.getByRole("heading", { level: 1 }).waitFor({ timeout: 15000 });
    await settle(page);
    await shoot(page, vp, "requests-list");
  });

  add("requests-filtered", "requests", async ({ page, session, vp }) => {
    await session.gotoWorkspace("/requests");
    await page.getByRole("heading", { level: 1 }).waitFor({ timeout: 15000 });
    await page.getByRole("button", { name: /Filters/ }).click();
    const filters = page.getByRole("dialog", { name: "Filters" });
    await filters.waitFor({ state: "visible", timeout: 5000 });
    const status = filters.getByRole("combobox", {
      name: /Filter requests by status/i,
    });
    const firstNonAllValue = await status.locator("option").nth(1).getAttribute("value");
    if (!firstNonAllValue) throw new Error("No request status filter options available");
    await status.selectOption(firstNonAllValue);
    await settle(page);
    await shoot(page, vp, "requests-filtered");
  });

  add("requests-approve-dialog", "requests", async ({ page, session, vp }) => {
    await session.gotoWorkspace("/requests");
    const row = page.locator(".request-row").first();
    await row.waitFor({ state: "visible", timeout: 8000 });
    await row.click();
    await page
      .getByRole("heading", { name: /Request details/i })
      .waitFor({ state: "visible", timeout: 8000 });
    await settle(page);
    await shoot(page, vp, "requests-approve-dialog", { clip: ".modal-panel" });
  });

  add("requests-reject-dialog", "requests", async ({ page, session, vp }) => {
    await session.gotoWorkspace("/requests");
    const row = page.locator(".request-row").first();
    await row.waitFor({ state: "visible", timeout: 8000 });
    await row.click();
    await page
      .getByRole("heading", { name: /Request details/i })
      .waitFor({ state: "visible", timeout: 8000 });
    await page.getByRole("button", { name: /Reject request/i }).click();
    await page
      .getByRole("heading", { name: /Return request/i })
      .waitFor({ state: "visible", timeout: 8000 });
    await settle(page);
    await shoot(page, vp, "requests-reject-dialog", { clip: ".modal-panel" });
  });

  add("requests-empty", "requests", async ({ page, session, vp }) => {
    await session.gotoWorkspace("/requests");
    await page
      .getByRole("textbox", { name: /Search requests/i })
      .fill("zzznonexistentxyz");
    await page
      .getByText(/No matching requests|All caught up/i)
      .waitFor({ timeout: 8000 });
    await settle(page);
    await shoot(page, vp, "requests-empty");
  });

  // ---- Calendar ----

  add("calendar-month", "calendar", async ({ page, session, vp }) => {
    await session.gotoWorkspace("/calendar");
    await page.getByRole("heading", { level: 1 }).waitFor({ timeout: 15000 });
    await settle(page);
    await shoot(page, vp, "calendar-month");
  });

  add("calendar-next-month", "calendar", async ({ page, session, vp }) => {
    await session.gotoWorkspace("/calendar");
    await page.getByRole("heading", { level: 1 }).waitFor({ timeout: 15000 });
    await page.getByRole("button", { name: /Next month/i }).click();
    await settle(page);
    await shoot(page, vp, "calendar-next-month");
  });

  add("calendar-prev-month", "calendar", async ({ page, session, vp }) => {
    await session.gotoWorkspace("/calendar");
    await page.getByRole("heading", { level: 1 }).waitFor({ timeout: 15000 });
    await page.getByRole("button", { name: /Previous month/i }).click();
    await settle(page);
    await shoot(page, vp, "calendar-prev-month");
  });

  add("calendar-empty-month", "calendar", async ({ page, session, vp }) => {
    await session.gotoWorkspace("/calendar");
    await page.getByRole("heading", { level: 1 }).waitFor({ timeout: 15000 });
    const nextButton = page.getByRole("button", { name: /Next month/i });
    for (let i = 0; i < 3; i += 1) {
      await nextButton.click();
    }
    await settle(page);
    await shoot(page, vp, "calendar-empty-month");
  });

  add("calendar-day-expanded", "calendar", async ({ page, session, vp }) => {
    // A deterministic crowded day exercises expansion even when demo dates move.
    const handler = async (route) => {
      const response = await route.fetch({ url: `${API_URL}/api/workspace` });
      const json = await response.json();
      const date = new Date();
      date.setDate(15);
      date.setHours(12, 0, 0, 0);
      json.tasks = json.tasks.map((task, index) =>
        index < 5 ? { ...task, dueAt: date.toISOString() } : task,
      );
      await route.fulfill({ response, json });
    };
    await page.route("**/api/workspace", handler);
    try {
      await session.gotoWorkspace("/calendar");
      const more =
        vp === "phone" || vp === "phone-small"
          ? page
              .locator(".schedule-day")
              .filter({ has: page.locator(".schedule-more") })
              .first()
              .locator(".schedule-day-number")
          : page.locator(".schedule-more").first();
      await more.waitFor({ state: "visible", timeout: 5000 });
      await more.click();
      await settle(page);
      await shoot(page, vp, "calendar-day-expanded", {
        clip: page.getByRole("dialog"),
      });
    } finally {
      await page.unroute("**/api/workspace", handler);
    }
  });

  add(
    "calendar-phone-agenda",
    "calendar",
    async ({ page, session, vp }) => {
      await session.gotoWorkspace("/calendar");
      await page.getByRole("heading", { level: 1 }).waitFor({ timeout: 15000 });
      await settle(page);
      await page
        .getByRole("combobox", { name: "Calendar view", exact: true })
        .selectOption("agenda");
      await shoot(page, vp, "calendar-phone-agenda");
    },
    { viewports: ["phone"] },
  );

  // ---- Reports ----

  add("reports-page", "reports", async ({ page, session, vp }) => {
    await session.gotoWorkspace("/reports");
    await page.getByRole("heading", { level: 1 }).waitFor({ timeout: 15000 });
    await settle(page);
    await shoot(page, vp, "reports-page");
  });

  // ---- Settings ----

  add("settings-members-table", "settings", async ({ page, session, vp }) => {
    await session.gotoWorkspace("/settings");
    await page.getByRole("heading", { level: 1 }).waitFor({ timeout: 15000 });
    await settle(page);
    await shoot(page, vp, "settings-members-table");
  });

  add(
    "settings-invite-member-form",
    "settings",
    async ({ page, session, vp }) => {
      await session.gotoWorkspace("/settings");
      await page.getByRole("button", { name: /Invite member/i }).click();
      await page
        .getByRole("heading", { name: /^Invite a member$/i })
        .waitFor({ state: "visible", timeout: 8000 });
      await settle(page);
      await shoot(page, vp, "settings-invite-member-form");
    },
  );

  add(
    "settings-departments-table",
    "settings",
    async ({ page, session, vp }) => {
      await session.gotoWorkspace("/settings#departments");
      await page.getByRole("heading", { name: "Settings" }).waitFor({ timeout: 15000 });
      await page
        .getByRole("heading", { name: "Departments", exact: true })
        .waitFor({ state: "visible", timeout: 8000 });
      await settle(page);
      await shoot(page, vp, "settings-departments-table");
    },
  );

  add(
    "settings-new-department-dialog",
    "settings",
    async ({ page, session, vp }) => {
      await session.gotoWorkspace("/settings#departments");
      await page.getByRole("button", { name: "New department" }).click();
      await page
        .getByRole("heading", { name: "New department", exact: true })
        .waitFor({ state: "visible", timeout: 8000 });
      await settle(page);
      await shoot(page, vp, "settings-new-department-dialog", {
        clip: page.getByRole("dialog"),
      });
    },
  );

  add(
    "settings-department-groups-drawer",
    "settings",
    async ({ page, session, vp }) => {
      await session.gotoWorkspace("/settings#departments");
      const manageGroups = page.getByRole("button", {
        name: /Manage .* groups for Sound/i,
      });
      await manageGroups.click();
      await page
        .getByRole("heading", { name: "Sound groups", exact: true })
        .waitFor({ state: "visible", timeout: 8000 });
      await settle(page);
      await shoot(page, vp, "settings-department-groups-drawer", {
        clip: page.getByRole("dialog"),
      });
    },
  );

  add(
    "settings-department-groups-design",
    "settings",
    async ({ page, session, vp }) => {
      await session.gotoWorkspace("/settings#departments");
      await page
        .getByRole("button", { name: /Manage .* groups for Design/i })
        .click();
      await page
        .getByRole("heading", { name: "Design groups", exact: true })
        .waitFor({ state: "visible", timeout: 8000 });
      await settle(page);
      await shoot(page, vp, "settings-department-groups-design", {
        clip: page.getByRole("dialog"),
      });
    },
  );

  add(
    "settings-rename-group-dialog",
    "settings",
    async ({ page, session, vp }) => {
      await session.gotoWorkspace("/settings#departments");
      await page
        .getByRole("button", { name: /Manage .* groups for Design/i })
        .click();
      await page
        .getByRole("heading", { name: "Design groups", exact: true })
        .waitFor({ state: "visible", timeout: 8000 });
      const firstGroup = page
        .getByRole("dialog")
        .getByRole("row")
        .nth(1)
        .getByRole("button", { name: /^Actions for / });
      const groupName = (await page
        .getByRole("dialog")
        .getByRole("row")
        .nth(1)
        .getByRole("rowheader")
        .innerText())
        .trim();
      await firstGroup.click();
      await page.getByRole("menuitem", { name: "Rename" }).click();
      await page
        .getByRole("heading", { name: "Rename group", exact: true })
        .waitFor({ state: "visible", timeout: 8000 });
      await page.getByLabel("Group name").waitFor({ state: "visible" });
      if (!(await page.getByLabel("Group name").inputValue()).trim()) {
        throw new Error(`The ${groupName} rename form did not retain its value`);
      }
      await settle(page);
      await shoot(page, vp, "settings-rename-group-dialog", {
        clip: page.getByRole("dialog").last(),
      });
    },
  );

  add(
    "settings-add-group-dialog",
    "settings",
    async ({ page, session, vp }) => {
      await session.gotoWorkspace("/settings#departments");
      await page
        .getByRole("button", { name: /Manage .* groups for Sound/i })
        .click();
      await page.getByRole("button", { name: "Add group" }).click();
      await page
        .getByRole("heading", { name: "Add group", exact: true })
        .waitFor({ state: "visible", timeout: 8000 });
      await settle(page);
      await shoot(page, vp, "settings-add-group-dialog", {
        clip: page.getByRole("dialog").last(),
      });
    },
  );

  // ---- Portal ----

  add("portal-home", "portal", async ({ page, vp }) => {
    await page.goto(PORTAL_URL, { waitUntil: "load" });
    await page.getByRole("button", { name: /Make a request/ }).waitFor();
    await settle(page);
    await shoot(page, vp, "portal-home");
  });

  add("portal-request-blank", "portal", async ({ page, vp }) => {
    await openPortalRequest(page);
    await settle(page);
    await shoot(page, vp, "portal-request-blank");
  });

  add("portal-request-validation-error", "portal", async ({ page, vp }) => {
    await openPortalRequest(page);
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await page
      .getByRole("alert")
      .first()
      .waitFor({ state: "visible", timeout: 5000 });
    await settle(page);
    await shoot(page, vp, "portal-request-validation-error", {
      clip: ".request-form",
    });
  });

  add("portal-request-filled", "portal", async ({ page, vp }) => {
    await openPortalRequest(page);
    await fillPortalRequestForm(page, { shortNotice: false });
    await settle(page);
    await shoot(page, vp, "portal-request-filled");
  });

  add("portal-request-short-notice", "portal", async ({ page, vp }) => {
    await openPortalRequest(page);
    await fillPortalRequestForm(page, { shortNotice: true, review: false });
    await page.waitForSelector(".short-notice");
    await settle(page);
    await shoot(page, vp, "portal-request-short-notice", {
      clip: ".request-form",
    });
  });

  add("portal-request-success", "portal", async ({ page, vp }) => {
    await openPortalRequest(page);
    await fillPortalRequestForm(page, { shortNotice: false });
    await page.getByRole("button", { name: /Send request/i }).click();
    await page.waitForSelector(".request-success", { timeout: 10000 });
    await settle(page);
    await shoot(page, vp, "portal-request-success");
  });

  add("portal-track-blank", "portal", async ({ page, vp }) => {
    await page.goto(PORTAL_URL, { waitUntil: "load" });
    await selectPortalTab(page, "Track");
    await page.waitForSelector(".track-form");
    await settle(page);
    await shoot(page, vp, "portal-track-blank");
  });

  add("portal-track-invalid-code", "portal", async ({ page, vp }) => {
    await page.goto(PORTAL_URL, { waitUntil: "load" });
    await selectPortalTab(page, "Track");
    await page.fill(".code-input", "NOT-A-REAL-CODE-000000");
    await page.click(".track-submit");
    await page.waitForSelector(".portal-error", { timeout: 10000 });
    await settle(page);
    await shoot(page, vp, "portal-track-invalid-code");
  });

  add("portal-track-found", "portal", async ({ page, vp }) => {
    if (!sharedTrackingCode) {
      throw new Error(
        "No demo tracking code available (pre-creation via API failed earlier)",
      );
    }
    await page.goto(PORTAL_URL, { waitUntil: "load" });
    await selectPortalTab(page, "Track");
    await page.fill(".code-input", sharedTrackingCode);
    await page.click(".track-submit");
    await page.waitForSelector(".tracking-summary", { timeout: 10000 });
    await settle(page);
    await shoot(page, vp, "portal-track-found");
  });

  return states;
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

// Guards against two concurrent invocations of this script racing on the
// same output directory — e.g. an unfiltered run wiping `.shots/` while a
// filtered run elsewhere is still writing into it. Only one run may hold
// the lock at a time; the lock is released on exit (success or failure).
// Deliberately NOT inside .shots/ — an unfiltered run wipes that whole
// directory, which would silently delete the lock file along with it.
const LOCK_FILE = path.join(ROOT, ".shots.lock");

function acquireLock() {
  if (existsSync(LOCK_FILE)) {
    const heldBy = (() => {
      try {
        return readFileSync(LOCK_FILE, "utf8").trim();
      } catch {
        return "unknown";
      }
    })();
    throw new Error(
      `Another scripts/shoot.mjs run appears to be in progress (lock held by pid ${heldBy}, ` +
        `${LOCK_FILE}). Refusing to start so it can't clobber that run's output. If that run is ` +
        `no longer alive, delete the lock file and retry.`,
    );
  }
  writeFileSync(LOCK_FILE, String(process.pid));
}

function releaseLock() {
  try {
    if (existsSync(LOCK_FILE)) unlinkSync(LOCK_FILE);
  } catch {
    // ignore
  }
}

async function main() {
  acquireLock();
  let isolatedApi;
  try {
    isolatedApi = await startUiTestApi([
      new URL(WORKSPACE_URL).origin,
      new URL(PORTAL_URL).origin,
    ]);
    API_URL = isolatedApi.url;
    await run();
  } finally {
    await isolatedApi?.stop();
    releaseLock();
  }
}

async function run() {
  if (!isFiltered) {
    rmSync(SHOTS_DIR, { recursive: true, force: true });
  }
  mkdirSync(SHOTS_DIR, { recursive: true });

  log("Pre-creating a demo request for the portal tracking 'found' state...");
  let sharedTrackingCode = null;
  try {
    sharedTrackingCode = await createDemoTrackingCode();
    log("  ok.");
  } catch (err) {
    log(`  WARN: ${err.message}`);
  }

  const allStates = buildStates(sharedTrackingCode);
  const matchedStates = allStates.filter(
    (s) => !onlyArg || s.name.includes(onlyArg),
  );
  const viewportsToRun = VIEWPORTS.filter(
    (v) => !viewportArg || v.name === viewportArg,
  );

  if (matchedStates.length === 0) {
    log(`No states match --only=${onlyArg}. Nothing to do.`);
    return;
  }
  if (viewportsToRun.length === 0) {
    log(`No viewport matches --viewport=${viewportArg}. Nothing to do.`);
    return;
  }

  const browser = await chromium.launch();
  const captured = [];
  const skipped = [];

  for (const vpDef of viewportsToRun) {
    log(`\n=== Viewport: ${vpDef.name} (${vpDef.width}x${vpDef.height}) ===`);
    const context = await browser.newContext({
      viewport: { width: vpDef.width, height: vpDef.height },
      reducedMotion: "reduce",
      colorScheme: "light",
    });
    await routeUiTestApi(context, CLIENT_API_URL, API_URL);
    await installFreeze(context);
    const page = await context.newPage();
    const session = new Session(page, context);

    for (const state of matchedStates) {
      if (state.viewports && !state.viewports.includes(vpDef.name)) continue;
      const label = `${vpDef.name}/${state.name}`;
      // The app source is under active, concurrent development while this
      // harness runs, which causes occasional transient Vite/HMR hiccups
      // (a blank reload, a slow recompile). One retry after a short pause
      // absorbs that noise without masking a genuinely broken state (which
      // will fail the same way on the retry too).
      const maxAttempts = 2;
      let lastErr = null;
      let ok = false;
      for (let attempt = 1; attempt <= maxAttempts && !ok; attempt += 1) {
        try {
          await state.fn({ page, context, session, vp: vpDef.name });
          ok = true;
        } catch (err) {
          lastErr = err;
          try {
            await page.unrouteAll({ behavior: "ignoreErrors" });
          } catch {
            // ignore
          }
          session.signedIn = false;
          if (attempt < maxAttempts) {
            await page.waitForTimeout(1200).catch(() => {});
          }
        }
      }
      if (ok) {
        captured.push({ label, group: state.group });
        log(`CAPTURED ${label}`);
      } else {
        const reason =
          lastErr && lastErr.message
            ? lastErr.message.split("\n")[0]
            : String(lastErr);
        skipped.push({ label, group: state.group, reason });
        log(`SKIP ${label}: ${reason}`);
      }
    }
    await context.close();
  }
  await browser.close();

  log(`\n==================== SUMMARY ====================`);
  log(`Captured: ${captured.length}`);
  log(`Skipped:  ${skipped.length}`);
  if (skipped.length) {
    log(`\nSkipped states:`);
    for (const s of skipped) log(`  - ${s.label}: ${s.reason}`);
  }
  log(`\nOutput: ${SHOTS_DIR}`);
  if (skipped.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
