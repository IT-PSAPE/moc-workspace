import { randomBytes } from "node:crypto";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { Hono } from "hono";
import type { Department, Leader, Session } from "@moc/shared";

const SESSION_COOKIE = "moc_session";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const departments: Department[] = ["cell-0", "sound", "visual-media", "design"];

interface StoredSession {
  user: Leader;
  demo: boolean;
  expiresAt: number;
}
export interface AuthDependencies {
  getDemoLeaderByDepartment(department: Department): Leader | null;
}

const sessions = new Map<string, StoredSession>();

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}
function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "Lax" as const,
    path: "/",
    maxAge,
  };
}
function newOpaqueValue(): string {
  return randomBytes(32).toString("base64url");
}
function error(
  c: Context,
  status: 400 | 403 | 500 | 502 | 503,
  message: string,
) {
  return c.json({ error: message }, status);
}

/** Read the API-managed session associated with this request's opaque cookie. */
export function getSession(c: Context): Session {
  const id = getCookie(c, SESSION_COOKIE);
  if (!id) return { user: null, demo: false };
  const stored = sessions.get(id);
  if (!stored) return { user: null, demo: false };
  if (stored.expiresAt <= Date.now()) {
    sessions.delete(id);
    return { user: null, demo: false };
  }
  return { user: stored.user, demo: stored.demo };
}

function setSession(c: Context, user: Leader, demo: boolean): void {
  const id = newOpaqueValue();
  sessions.set(id, { user, demo, expiresAt: Date.now() + SESSION_TTL_MS });
  setCookie(c, SESSION_COOKIE, id, cookieOptions(SESSION_TTL_MS / 1000));
}

function revokeSession(c: Context): void {
  const id = getCookie(c, SESSION_COOKIE);
  if (id) sessions.delete(id);
  deleteCookie(c, SESSION_COOKIE, {
    path: "/",
    secure: isProduction(),
    httpOnly: true,
    sameSite: "Lax",
  });
}

/** Creates API-owned authentication endpoints. Mount the returned router at /api/auth. */
export function createAuthRouter(deps: AuthDependencies): Hono {
  const router = new Hono();

  router.post("/demo", async (c) => {
    if (isProduction() || process.env.DEMO_MODE !== "true") {
      return error(
        c,
        403,
        "Demo sign-in is disabled. Use approved Google sign-in.",
      );
    }
    const body = (await c.req.json().catch(() => null)) as {
      department?: unknown;
    } | null;
    if (
      !body ||
      typeof body.department !== "string" ||
      !departments.includes(body.department as Department)
    ) {
      return error(c, 400, "Choose a valid department for demo sign-in.");
    }
    const user = deps.getDemoLeaderByDepartment(body.department as Department);
    if (!user || !user.approved)
      return error(
        c,
        403,
        "No approved demo member is configured for that department.",
      );
    setSession(c, user, true);
    return c.json({ user, demo: true } satisfies Session);
  });

  router.post("/logout", (c) => {
    revokeSession(c);
    return c.json({ user: null, demo: false } satisfies Session);
  });

  router.get("/google", (c) => c.json({ error: "Configure Supabase Auth to enable Google sign-in." }, 503));
  return router;
}
