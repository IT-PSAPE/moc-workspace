import {
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  Outlet,
} from "@tanstack/react-router";
import { API_URL, api, useSession } from "@moc/client";
import { useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  Compass,
  ShieldCheck,
  RefreshCw,
} from "lucide-react";
import type { Session } from "@moc/shared";
import Shell from "./Shell";
import Dashboard from "./pages/Dashboard";
import Departments from "./pages/Departments";
import DepartmentPage from "./pages/Department";
import Requests from "./pages/Requests";
import Calendar from "./pages/Calendar";
import Reports from "./pages/Reports";
import Settings from "./pages/Settings";

function Gate() {
  const { session, loading, error, refresh } = useSession();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  if (loading)
    return (
      <div className="access-screen">
        <div className="access-loading" role="status" aria-live="polite">
          <span className="access-wordmark">
            MOC<span>.</span>
          </span>
          <span className="access-spinner" aria-hidden="true" />
          <p>Preparing your workspace…</p>
        </div>
      </div>
    );
  if (!session?.user)
    return (
      <div className="access-screen">
        <div className="access-card">
          <span className="access-wordmark">
            MOC<span>.</span>
          </span>
          <h1>
            Good work starts
            <br />
            with a little clarity.
          </h1>
          <p>
            Welcome to MOC Workspace. Sign in with your approved member account
            to bring your team's work together.
          </p>
          {(error || failure) && (
            <p role="alert" className="access-error">
              <AlertCircle size={16} aria-hidden="true" />
              <span>{error || failure}</span>
            </p>
          )}
          <a
            className="button button-primary"
            href={`${API_URL}/api/auth/google`}
          >
            Continue with Google <ArrowRight size={16} />
          </a>
          {import.meta.env.DEV && session?.demo && (
            <button
              className="button button-secondary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api<Session>("/api/auth/demo", {
                    method: "POST",
                    body: JSON.stringify({ department: "cell-0" }),
                  });
                  window.location.assign("/");
                } catch (e) {
                  setFailure((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "Opening…" : "Open workspace"}
            </button>
          )}
          {error && (
            <button
              className="button button-secondary"
              onClick={() => refresh()}
            >
              <RefreshCw size={15} />
              Retry connection
            </button>
          )}
          <small>
            <ShieldCheck size={14} /> Access is reserved for approved MOC
            members.
          </small>
          <a href={import.meta.env.VITE_PORTAL_URL || "http://localhost:5174"}>
            Need support? Visit the public request portal →
          </a>
        </div>
      </div>
    );
  if (!session.user.approved)
    return (
      <div className="access-screen">
        <section className="access-card">
          <ShieldCheck size={24} aria-hidden="true" />
          <h1>Workspace access required</h1>
          <p>
            Your member account is not approved. Contact Cell 0 to confirm your
            access.
          </p>
          {failure && (
            <p className="access-error" role="alert">
              {failure}
            </p>
          )}
          <button
            className="button button-primary"
            onClick={() => void refresh()}
          >
            Check access
          </button>
          <button
            className="button button-secondary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setFailure("");
              try {
                await api("/api/auth/logout", { method: "POST" });
                window.location.assign("/login");
              } catch (cause) {
                setFailure(
                  cause instanceof Error
                    ? cause.message
                    : "Could not sign out.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Signing out…" : "Sign out"}
          </button>
        </section>
      </div>
    );
  return (
    <Shell>
      <Outlet />
    </Shell>
  );
}
const root = createRootRoute({
  component: Gate,
  notFoundComponent: () => (
    <div className="not-found-state">
      <div className="card empty-state not-found-card">
        <Compass size={28} strokeWidth={1.6} aria-hidden="true" />
        <h2>Page not found</h2>
        <p>Let’s get back to your workspace.</p>
        <a className="button button-primary" href="/">
          Open dashboard <ArrowRight size={16} />
        </a>
      </div>
    </div>
  ),
});
const dashboard = createRoute({
  getParentRoute: () => root,
  path: "/",
  component: Dashboard,
});
const departments = createRoute({
  getParentRoute: () => root,
  path: "/departments",
  component: Departments,
});
const department = createRoute({
  getParentRoute: () => root,
  path: "/departments/$department",
  component: () => {
    const { department: slug } = department.useParams();
    return <DepartmentPage department={slug} />;
  },
});
const requests = createRoute({
  getParentRoute: () => root,
  path: "/requests",
  component: Requests,
});
const calendar = createRoute({
  getParentRoute: () => root,
  path: "/calendar",
  component: Calendar,
});
const reports = createRoute({
  getParentRoute: () => root,
  path: "/reports",
  component: Reports,
});
const settings = createRoute({
  getParentRoute: () => root,
  path: "/settings",
  component: Settings,
});
const login = createRoute({
  getParentRoute: () => root,
  path: "/login",
  component: Dashboard,
});
const router = createRouter({
  routeTree: root.addChildren([
    dashboard,
    departments,
    department,
    requests,
    calendar,
    reports,
    settings,
    login,
  ]),
});
export default function App() {
  return <RouterProvider router={router} />;
}
