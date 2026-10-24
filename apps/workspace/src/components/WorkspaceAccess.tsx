import { useId, useState, type ReactNode } from "react";
import { AlertCircle, ArrowRight, ArrowUpRight, RefreshCw, ShieldCheck } from "lucide-react";
import { API_URL, api, neonAuth, signInWithGoogle } from "@moc/client";
import { Button } from "@moc/ui";
import type { Session } from "@moc/shared";
import "./workspace-access.css";

function GoogleMark() {
  return <svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true" focusable="false">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z" />
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65Z" />
    <path fill="#FBBC05" d="M10.53 28.59A14.42 14.42 0 0 1 9.75 24c0-1.59.27-3.13.79-4.59l-7.98-6.19A23.92 23.92 0 0 0 0 24c0 3.87.93 7.53 2.56 10.78l7.97-6.19Z" />
    <path fill="#34A853" d="M24 48c6.48 0 11.92-2.13 15.89-5.8l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.97 6.19C6.51 42.62 14.62 48 24 48Z" />
  </svg>;
}

function AccessLayout({ children }: { children: ReactNode }) {
  const portalUrl = import.meta.env.VITE_PORTAL_URL || "http://localhost:5174";
  return <main className="login-page" id="main-content">
    <section className="login-story" aria-label="MOC Workspace">
      <div className="login-brand">
        <img src="/favicon.svg" width="38" height="38" alt="" />
        <span>MOC <span className="login-brand-secondary">Workspace</span></span>
      </div>
      <div className="login-story-copy">
        <p className="login-eyebrow">A shared space for your team</p>
        <p className="login-statement">Good work.<br /><span>Shared purpose.</span></p>
        <p className="login-story-description">Bring your people, requests and creative work together. Make room for what matters.</p>
      </div>
      <div className="login-story-art" aria-hidden="true">
        <img src="/favicon.svg" width="580" height="580" alt="" />
      </div>
      <p className="login-story-footer">Created with care. Carried out together.</p>
    </section>
    <section className="login-panel" aria-labelledby="login-heading">
      <div className="login-panel-top"><ShieldCheck size={15} aria-hidden="true" /><span>Your team’s workspace</span></div>
      <div className="login-form">{children}</div>
      <footer className="login-footer">
        <span>Here to submit a request?</span>
        <a href={portalUrl}>Open request portal <ArrowUpRight size={15} aria-hidden="true" /></a>
      </footer>
    </section>
  </main>;
}

export default function WorkspaceAccess({ session, loading, error, refresh }: {
  session: Session | undefined;
  loading: boolean;
  error?: string;
  refresh: () => Promise<unknown>;
}) {
  const [busy, setBusy] = useState<"signin" | "demo" | "retry" | "logout" | null>(null);
  const [failure, setFailure] = useState("");
  const hintId = useId();
  const pendingApproval = Boolean(session?.user && !session.user.approved);
  const message = error || failure;

  async function perform(action: NonNullable<typeof busy>, operation: () => Promise<unknown>) {
    if (busy) return;
    setBusy(action);
    setFailure("");
    try { await operation(); }
    catch (cause) { setFailure(cause instanceof Error ? cause.message : "We couldn’t connect. Please try again."); }
    finally { setBusy(null); }
  }

  return <AccessLayout>
    <p className="login-eyebrow">MOC Workspace</p>
    <h1 id="login-heading">{loading ? "Getting things ready." : pendingApproval ? "You’re almost there." : "Welcome back."}</h1>
    <p className="login-description">{loading ? "Connecting to your workspace…" : pendingApproval
      ? "Ask your Cell 0 team to approve your account, then check your access below."
      : "A little clarity for the work ahead. Sign in to your workspace to get started."}</p>
    {loading ? <div className="login-loading" role="status"><span className="access-spinner" aria-hidden="true" /><span>Restoring your session</span></div> : <>
      <div className="login-actions">
        {pendingApproval ? <>
          <Button variant="primary" disabled={Boolean(busy)} onClick={() => void perform("retry", refresh)}>
            {busy === "retry" ? "Checking access…" : "Check access"}<ArrowRight size={17} aria-hidden="true" />
          </Button>
          <Button disabled={Boolean(busy)} onClick={() => void perform("logout", async () => {
            if (neonAuth) {
              const result = await neonAuth.signOut();
              if (result.error) throw new Error(result.error.message || "Could not sign out.");
            }
            await api("/api/auth/logout", { method: "POST" });
            window.location.assign("/login");
          })}>{busy === "logout" ? "Signing out…" : "Sign out"}</Button>
        </> : <>
          {neonAuth ? <Button className="login-google-button" disabled={Boolean(busy)} aria-describedby={hintId}
            onClick={() => void perform("signin", signInWithGoogle)}>
            {busy === "signin" ? <span className="login-button-spinner" aria-hidden="true" /> : <GoogleMark />}
            <span>{busy === "signin" ? "Opening Google…" : "Continue with Google"}</span>
            <ArrowRight className="login-button-arrow" size={17} aria-hidden="true" />
          </Button> : <a className="button button-secondary login-google-button" aria-describedby={hintId} href={`${API_URL}/api/auth/google`}>
            <GoogleMark /><span>Continue with Google</span><ArrowRight className="login-button-arrow" size={17} aria-hidden="true" />
          </a>}
          {import.meta.env.DEV && session?.demo && <Button variant="primary" disabled={Boolean(busy)} onClick={() => void perform("demo", async () => {
            await api<Session>("/api/auth/demo", { method: "POST", body: JSON.stringify({ department: "cell-0" }) });
            window.location.assign("/");
          })}>{busy === "demo" ? "Opening…" : "Open workspace"}</Button>}
          <p id={hintId} className="login-account-hint">Use the Google account you were invited with.</p>
        </>}
      </div>
      {message && <div className="login-error" role="alert">
        <AlertCircle size={17} aria-hidden="true" /><span>{message}</span>
      </div>}
      {error && <Button className="login-retry" disabled={Boolean(busy)} onClick={() => void perform("retry", refresh)}>
        <RefreshCw size={15} aria-hidden="true" />{busy === "retry" ? "Connecting…" : "Retry connection"}
      </Button>}
      <p className="login-access-note"><ShieldCheck size={15} aria-hidden="true" /><span>Workspace access is managed by your Cell 0 team.</span></p>
    </>}
  </AccessLayout>;
}
