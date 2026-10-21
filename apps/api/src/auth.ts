import { randomBytes, createHash } from "node:crypto";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { Hono } from "hono";
import type { Department, Leader, Session } from "@moc/shared";

const SESSION_COOKIE = "moc_session";
const STATE_COOKIE = "moc_oauth_state";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const OAUTH_TTL_MS = 10 * 60 * 1000;
const departments: Department[] = ["cell-0", "sound", "visual-media", "design"];

interface StoredSession {
  user: Leader;
  demo: boolean;
  expiresAt: number;
}
interface OAuthAttempt {
  verifier: string;
  expiresAt: number;
}

export interface AuthDependencies {
  findApprovedLeaderByGoogleEmail(email: string): Promise<Leader | null>;
  getDemoLeaderByDepartment(department: Department): Leader | null;
}

const sessions = new Map<string, StoredSession>();
const oauthAttempts = new Map<string, OAuthAttempt>();

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
function redirectUri(): string {
  return (
    process.env.GOOGLE_REDIRECT_URI ||
    `${(process.env.API_URL || "http://localhost:3001").replace(/\/$/, "")}/api/auth/google/callback`
  );
}
function workspaceUrl(): string {
  return process.env.WORKSPACE_URL || "http://localhost:5173";
}
function oauthConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
  );
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

function pruneExpiredOAuthAttempts(): void {
  const now = Date.now();
  for (const [state, attempt] of oauthAttempts)
    if (attempt.expiresAt <= now) oauthAttempts.delete(state);
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

  router.get("/google", (c) => {
    if (!oauthConfigured())
      return error(
        c,
        503,
        "Google sign-in is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the API.",
      );
    pruneExpiredOAuthAttempts();
    const state = newOpaqueValue();
    const verifier = newOpaqueValue();
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    oauthAttempts.set(state, {
      verifier,
      expiresAt: Date.now() + OAUTH_TTL_MS,
    });
    setCookie(c, STATE_COOKIE, state, {
      ...cookieOptions(OAUTH_TTL_MS / 1000),
      path: "/api/auth",
    });
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      redirect_uri: redirectUri(),
      response_type: "code",
      scope: "openid email profile",
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
      prompt: "select_account",
    }).toString();
    return c.redirect(url.toString(), 302);
  });

  router.get("/google/callback", async (c) => {
    if (!oauthConfigured())
      return error(
        c,
        503,
        "Google sign-in is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the API.",
      );
    const state = c.req.query("state");
    const code = c.req.query("code");
    const cookieState = getCookie(c, STATE_COOKIE);
    deleteCookie(c, STATE_COOKIE, {
      path: "/api/auth",
      secure: isProduction(),
      httpOnly: true,
      sameSite: "Lax",
    });
    if (c.req.query("error"))
      return error(c, 403, "Google sign-in was cancelled or denied.");
    if (!state || !cookieState || state !== cookieState)
      return error(
        c,
        400,
        "Google sign-in state did not match. Please start sign-in again.",
      );
    const attempt = oauthAttempts.get(state);
    oauthAttempts.delete(state);
    if (!attempt || attempt.expiresAt <= Date.now())
      return error(
        c,
        400,
        "Google sign-in expired. Please start sign-in again.",
      );
    if (!code)
      return error(
        c,
        400,
        "Google did not return an authorization code. Please start sign-in again.",
      );

    try {
      const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: process.env.GOOGLE_CLIENT_ID!,
          client_secret: process.env.GOOGLE_CLIENT_SECRET!,
          redirect_uri: redirectUri(),
          grant_type: "authorization_code",
          code_verifier: attempt.verifier,
        }),
      });
      if (!tokenResponse.ok)
        return error(
          c,
          502,
          "Google could not complete sign-in. Please try again.",
        );
      const tokens = (await tokenResponse.json()) as {
        access_token?: string;
        token_type?: string;
      };
      if (!tokens.access_token)
        return error(
          c,
          502,
          "Google did not provide an access token. Please try again.",
        );
      const profileResponse = await fetch(
        "https://openidconnect.googleapis.com/v1/userinfo",
        {
          headers: {
            authorization: `${tokens.token_type || "Bearer"} ${tokens.access_token}`,
          },
        },
      );
      if (!profileResponse.ok)
        return error(
          c,
          502,
          "Google could not verify your account. Please try again.",
        );
      const profile = (await profileResponse.json()) as {
        email?: string;
        email_verified?: boolean;
      };
      if (profile.email_verified !== true || !profile.email)
        return error(
          c,
          403,
          "Google must verify your email address before you can sign in.",
        );
      const user = await deps.findApprovedLeaderByGoogleEmail(
        profile.email.trim().toLowerCase(),
      );
      if (!user || !user.approved)
        return error(
          c,
          403,
          "This Google account is not an approved member. Contact Cell 0 for access.",
        );
      setSession(c, user, false);
      return c.redirect(workspaceUrl(), 302);
    } catch {
      return error(
        c,
        502,
        "Google sign-in could not be completed. Please try again.",
      );
    }
  });

  return router;
}
