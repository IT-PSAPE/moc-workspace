import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createSeedState } from "@moc/shared";
import { createApiApp } from "./index";
import type { Repository } from "./repository";
import { createSupabaseAuthRouter, supabaseSessionResolver } from "./supabase-auth";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const member = createSeedState().users.find((user) => user.approved && user.isLeader)!;
const verified = { id: "auth-id", email: member.email, email_confirmed_at: "2026-11-04T00:00:00Z", identities: [{ provider: "google" }] } as User;
function harness(user: User | null = verified) {
  const repository = {
    findApprovedLeaderByGoogleEmail: vi.fn().mockResolvedValue(member),
    findApprovedLeaderById: vi.fn().mockResolvedValue(member),
    getDemoLeaderByDepartment: () => null,
  } as unknown as Repository;
  const auth = {
    getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
    signInWithOAuth: vi.fn().mockResolvedValue({ data: { url: "https://project.supabase.co/auth/v1/authorize?provider=google" }, error: null }),
    exchangeCodeForSession: vi.fn().mockResolvedValue({ data: { session: { access_token: "must-not-leak" } }, error: null }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
  };
  const client = { auth } as unknown as SupabaseClient;
  const factory = vi.fn(() => client);
  const app = createApiApp(repository, { resolveSession: supabaseSessionResolver(repository, factory), authRouter: createSupabaseAuthRouter(repository, factory) });
  return { app, repository, factory, auth };
}
const cookies = { cookie: "moc_auth=server-session" };

describe("API-owned Supabase Google authentication", () => {
  it("starts Google OAuth with a fixed callback and never accepts a return URL from the request", async () => {
    const { app, auth } = harness();
    const response = await app.request("/api/auth/google?next=https://attacker.invalid");
    expect(response.status).toBe(302);
    expect(auth.signInWithOAuth).toHaveBeenCalledWith({ provider: "google", options: { redirectTo: "http://localhost:5173/api/auth/callback", skipBrowserRedirect: true, queryParams: { prompt: "select_account" } } });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("exchanges PKCE codes, verifies the user with Auth, and resolves the approved email on the server", async () => {
    const { app, auth, repository } = harness();
    const response = await app.request("/api/auth/callback?code=one-use-code&sb_flow_id=flow");
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith("one-use-code", { flowId: "flow" });
    expect(auth.getUser).toHaveBeenCalled();
    expect(repository.findApprovedLeaderByGoogleEmail).toHaveBeenCalledWith(member.email.toLowerCase());
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://localhost:5173");
    expect(await response.text()).not.toContain("must-not-leak");
  });
  it.each([
    { ...verified, email_confirmed_at: undefined },
    { ...verified, identities: [{ provider: "email" }], user_metadata: { provider: "google", email_verified: true, approved: true } },
    { ...verified, email: undefined },
  ] as unknown as User[])("rejects unverified or non-Google identities despite editable metadata", async (user) => {
    const { app, auth, repository } = harness(user);
    const response = await app.request("/api/session", { headers: cookies });
    expect(await response.json()).toEqual({ user: null, demo: false });
    expect(repository.findApprovedLeaderByGoogleEmail).not.toHaveBeenCalled();
    const callback = await app.request("/api/auth/callback?code=code");
    expect(callback.headers.get("location")).toContain("auth_error=denied");
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });
  it("does no Auth/database work for anonymous requests or forged browser bearer claims", async () => {
    const { app, factory, repository } = harness();
    expect(await (await app.request("/api/session", { headers: { authorization: "Bearer fake.jwt.claim", cookie: "other=value" } })).json()).toEqual({ user: null, demo: false });
    expect(factory).not.toHaveBeenCalled();
    expect(repository.findApprovedLeaderByGoogleEmail).not.toHaveBeenCalled();
  });
  it("rejects expired cookies, preserves transient outage errors, and honors revocation", async () => {
    const { app, auth, repository } = harness();
    auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: { status: 401, name: "AuthApiError" } } as never);
    expect(await (await app.request("/api/session", { headers: cookies })).json()).toEqual({ user: null, demo: false });
    auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: { status: 503, name: "AuthRetryableFetchError" } } as never);
    expect((await app.request("/api/session", { headers: cookies })).status).toBe(503);
    vi.mocked(repository.findApprovedLeaderByGoogleEmail).mockResolvedValueOnce(null);
    expect(await (await app.request("/api/session", { headers: cookies })).json()).toEqual({ user: null, demo: false });
    expect((await app.request("/api/auth/demo", { method: "POST", headers: { origin: "http://localhost:5173" } })).status).toBe(403);
  });
  it("requires the allowed origin to log out and signs out only the current session", async () => {
    const { app, auth } = harness();
    expect((await app.request("/api/auth/logout", { method: "POST", headers: { origin: "https://attacker.invalid", ...cookies } })).status).toBe(403);
    expect(auth.signOut).not.toHaveBeenCalled();
    expect((await app.request("/api/auth/logout", { method: "POST", headers: { origin: "http://localhost:5173", ...cookies } })).status).toBe(200);
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });
  it("returns understandable callback failures without reflecting provider errors", async () => {
    const { app, auth } = harness();
    const cancelled = await app.request("/api/auth/callback?error=provider_secret&error_description=private");
    expect(cancelled.headers.get("location")).toBe("http://localhost:5173/login?auth_error=cancelled");
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
    expect((await app.request("/api/auth/callback")).headers.get("location")).toContain("auth_error=expired");
    auth.exchangeCodeForSession.mockResolvedValueOnce({ error: { message: "code expired" } } as never);
    expect((await app.request("/api/auth/callback?code=expired")).headers.get("location")).toContain("auth_error=expired");
  });
  it("the real SSR SDK puts the PKCE verifier into an HttpOnly secure cookie on the redirect", async () => {
    vi.stubEnv("SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test");
    vi.stubEnv("NODE_ENV", "production");
    const router = new Hono().route("/api/auth", createSupabaseAuthRouter({} as Repository));
    const response = await router.request("/api/auth/google");
    const location = new URL(response.headers.get("location")!);
    expect(location.origin).toBe("https://project.supabase.co");
    expect(location.searchParams.get("provider")).toBe("google");
    expect(location.searchParams.get("code_challenge_method")).toBe("s256");
    expect(location.searchParams.get("code_challenge")).toBeTruthy();
    const cookie = response.headers.get("set-cookie");
    expect(cookie).toContain("moc_auth-code-verifier=");
    expect(cookie?.toLowerCase()).toContain("httponly");
    expect(cookie?.toLowerCase()).toContain("secure");
    expect(cookie?.toLowerCase()).toContain("samesite=lax");
  });
  it("the real SSR SDK exchanges and refreshes cookies across fresh API instances without browser tokens", async () => {
    vi.stubEnv("SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test");
    vi.stubEnv("NODE_ENV", "production");
    vi.useFakeTimers({ toFake: ["Date"] });
    const tokenCalls: Record<string, unknown>[] = [];
    const jwt = () => [
      Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"),
      Buffer.from(JSON.stringify({ sub: verified.id, aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000) })).toString("base64url"),
      "test-signature",
    ].join(".");
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      if (url.pathname === "/auth/v1/token") {
        tokenCalls.push({ grant: url.searchParams.get("grant_type"), ...JSON.parse(String(init?.body)) });
        return new Response(JSON.stringify({ access_token: jwt(), refresh_token: "rotated-refresh", token_type: "bearer", expires_in: 3600, user: verified }), { headers: { "content-type": "application/json" } });
      }
      if (url.pathname === "/auth/v1/user") return new Response(JSON.stringify(verified), { headers: { "content-type": "application/json" } });
      throw new Error(`Unexpected Auth endpoint: ${url.pathname}`);
    }));
    const { repository } = harness();
    const fresh = () => createApiApp(repository, { resolveSession: supabaseSessionResolver(repository), authRouter: createSupabaseAuthRouter(repository) });
    const cookieHeader = (response: Response) => response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
    try {
      const start = await fresh().request("/api/auth/google");
      const callback = await fresh().request("/api/auth/callback?code=issued-code", { headers: { cookie: cookieHeader(start) } });
      expect(callback.status).toBe(303);
      expect(callback.headers.get("location")).toBe("http://localhost:5173");
      expect(tokenCalls[0]).toMatchObject({ grant: "pkce", auth_code: "issued-code", code_verifier: expect.any(String) });
      const cookie = cookieHeader(callback);
      expect(cookie).toContain("moc_auth=");
      const restored = await fresh().request("/api/session", { headers: { cookie } });
      expect(await restored.json()).toEqual({ user: member, demo: false });
      vi.setSystemTime(Date.now() + 2 * 60 * 60 * 1000);
      const refreshed = await fresh().request("/api/session", { headers: { cookie } });
      expect(await refreshed.json()).toEqual({ user: member, demo: false });
      expect(tokenCalls[1]).toMatchObject({ grant: "refresh_token", refresh_token: "rotated-refresh" });
      expect(refreshed.headers.get("set-cookie")).toContain("HttpOnly");
      expect(refreshed.headers.get("cache-control")).toContain("no-store");
    } finally { vi.useRealTimers(); }
  });

});
