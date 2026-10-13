import {
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  Outlet,
} from "@tanstack/react-router";
import { API_URL, api, useSession } from "@moc/client";
import { useState } from "react";
import { ArrowRight, ShieldCheck, RefreshCw } from "lucide-react";
import type { Department, Session } from "@moc/shared";
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
        <span className="access-wordmark">
          MOC<span>.</span>
        </span>
        <p>Preparing your workspace…</p>
      </div>
    );
  if (!session?.user)
    return (
      <div className="access-screen">
        <div className="access-card">
          <span className="access-wordmark">
            MOC<span>.</span>
          </span>
          <span className="eyebrow">MINISTRY OF CULTURE</span>
          <h1>
            Good work starts
            <br />
            with a little clarity.
          </h1>
          <p>
            Welcome to MOC Workspace. Sign in with your approved leader account
            to bring your team's work together.
          </p>
          {(error || failure) && (
            <p role="alert" className="access-error">
              {error || failure}
            </p>
          )}
          <a
            className="button button-primary"
            href={`${API_URL}/api/auth/google`}
          >
            Continue with Google <ArrowRight size={16} />
          </a>
          {session?.demo && (
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
              {busy ? "Opening…" : "Explore the demo workspace"}
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
            leaders.
          </small>
          <a href={import.meta.env.VITE_PORTAL_URL || "http://localhost:5174"}>
            Need support? Visit the public request portal →
          </a>
        </div>
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
    <div className="card empty-state">
      <h2>Page not found</h2>
      <p>Let’s get back to your workspace.</p>
      <a href="/">Open dashboard</a>
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
    const valid: Department[] = ["cell-0", "sound", "design", "visual-media"];
    return valid.includes(slug as Department) ? (
      <DepartmentPage department={slug as Department} />
    ) : (
      <div className="card empty-state">
        Department not found. <a href="/departments">View departments</a>
      </div>
    );
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
