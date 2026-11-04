import { createServerClient, parseCookieHeader, serializeCookieHeader } from "@supabase/ssr";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Session } from "@moc/shared";
import type { Repository } from "./repository";
import { supabaseConfig } from "./supabase";

export type AuthClientFactory = (context: Context) => SupabaseClient;
const requestClients = new WeakMap<Context, SupabaseClient>();

/** Request-scoped SSR client: PKCE + session refresh survive serverless instances.
 * Only the API reads the HttpOnly cookies; the browser has no Supabase SDK. */
export function supabaseAuthClient(c: Context): SupabaseClient {
  const previous = requestClients.get(c);
  if (previous) return previous;
  const { url, publishableKey } = supabaseConfig();
  const client = createServerClient(url, publishableKey, {
    cookieOptions: { name: "moc_auth", path: "/", httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" },
    cookies: {
      getAll: () => parseCookieHeader(c.req.header("cookie") ?? ""),
      setAll: (cookies, headers) => {
        for (const { name, value, options } of cookies)
          c.header("Set-Cookie", serializeCookieHeader(name, value, { ...options, httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" }), { append: true });
        for (const [name, value] of Object.entries(headers)) c.header(name, value);
      },
    },
  });
  requestClients.set(c, client);
  return client;
}

function verifiedGoogleEmail(user: User | null): string | undefined {
  // getUser() is validated by Supabase Auth. Never trust user_metadata, a
  // browser-supplied email, or a decoded but unverified JWT for authorization.
  if (!user?.email_confirmed_at || !user.email || !user.identities?.some((identity) => identity.provider === "google")) return;
  return user.email.trim().toLowerCase();
}

export function supabaseSessionResolver(repository: Repository, clientFor: AuthClientFactory = supabaseAuthClient) {
  return async (c: Context): Promise<Session> => {
    // Anonymous portal/session requests must not contact Auth or the database.
    if (!parseCookieHeader(c.req.header("cookie") ?? "").some(({ name }) => name === "moc_auth" || /^moc_auth\.\d+$/.test(name)))
      return { user: null, demo: false };
    const { data, error } = await clientFor(c).auth.getUser();
    if (error) {
      if (error.name === "AuthSessionMissingError" || (error.status && error.status >= 400 && error.status < 500 && error.status !== 429))
        return { user: null, demo: false };
      throw new HTTPException(503, { message: "Sign-in verification is temporarily unavailable. Please retry." });
    }
    const email = verifiedGoogleEmail(data.user);
    return { user: email ? await repository.findApprovedLeaderByGoogleEmail(email) : null, demo: false };
  };
}

export function createSupabaseAuthRouter(repository: Repository, clientFor: AuthClientFactory = supabaseAuthClient): Hono {
  const router = new Hono();
  const workspace = (process.env.WORKSPACE_URL || "http://localhost:5173").replace(/\/$/, "");
  const failed = (c: Context, reason: string) => c.redirect(`${workspace}/login?auth_error=${reason}`, 303);

  router.get("/google", async (c) => {
    const { data, error } = await clientFor(c).auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${workspace}/api/auth/callback`, skipBrowserRedirect: true, queryParams: { prompt: "select_account" } },
    });
    if (error || !data.url) return failed(c, "unavailable");
    return c.redirect(data.url, 302);
  });
  router.get("/callback", async (c) => {
    if (c.req.query("error")) return failed(c, "cancelled");
    const code = c.req.query("code");
    if (!code) return failed(c, "expired");
    const client = clientFor(c);
    const flowId = c.req.query("sb_flow_id");
    const { error } = await client.auth.exchangeCodeForSession(code, flowId ? { flowId } : undefined);
    if (error) return failed(c, "expired");
    const { data, error: identityError } = await client.auth.getUser();
    if (identityError) return failed(c, "unavailable");
    const email = verifiedGoogleEmail(data.user);
    const member = email ? await repository.findApprovedLeaderByGoogleEmail(email) : null;
    if (!member?.approved) {
      await client.auth.signOut({ scope: "local" });
      return failed(c, "denied");
    }
    return c.redirect(workspace, 303);
  });
  router.post("/logout", async (c) => {
    const { error } = await clientFor(c).auth.signOut({ scope: "local" });
    if (error && error.name !== "AuthSessionMissingError")
      throw new HTTPException(503, { message: "Could not sign out. Please retry." });
    return c.json({ user: null, demo: false } satisfies Session);
  });
  router.post("/demo", (c) => c.json({ error: "Demo sign-in is disabled. Use approved Google sign-in." }, 403));
  return router;
}
