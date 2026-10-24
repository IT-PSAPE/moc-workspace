import { createAuthClient } from "@neondatabase/auth";

const env = (import.meta as ImportMeta & { env?: Record<string, string> }).env;
export const neonAuth = env?.VITE_NEON_AUTH_URL ? createAuthClient(env.VITE_NEON_AUTH_URL) : null;

export async function signInWithGoogle() {
  if (!neonAuth) throw new Error("Neon Auth is not configured.");
  const { error } = await neonAuth.signIn.social({ provider: "google", callbackURL: window.location.origin });
  if (error) throw new Error(error.message || "Google sign-in failed.");
}

export async function authHeaders(): Promise<Record<string, string>> {
  if (!neonAuth) return {};
  const session = await neonAuth.getSession();
  if (session.error) throw new Error(session.error.message || "Sign-in could not be restored.");
  if (!session.data?.user) return {};
  // This SDK version injects the JWT into getSession() from set-auth-jwt.
  // Its /token helper can return an empty body for a valid browser session.
  const sessionToken = session.data.session?.token;
  if (sessionToken && sessionToken.split(".").length === 3)
    return { Authorization: `Bearer ${sessionToken}` };
  const { data, error } = await neonAuth.token();
  if (error || !data?.token) throw new Error(error?.message || "Sign-in token is unavailable.");
  return { Authorization: `Bearer ${data.token}` };
}
