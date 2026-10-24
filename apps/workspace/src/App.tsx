import {
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  Outlet,
} from "@tanstack/react-router";
import { useSession } from "@moc/client";
import { ArrowRight, Compass } from "lucide-react";
import Shell from "./Shell";
import Dashboard from "./pages/Dashboard";
import Departments from "./pages/Departments";
import DepartmentPage from "./pages/Department";
import Requests from "./pages/Requests";
import Calendar from "./pages/Calendar";
import Reports from "./pages/Reports";
import Settings from "./pages/Settings";
import WorkspaceAccess from "./components/WorkspaceAccess";

function Gate() {
  const { session, loading, error, refresh } = useSession();
  if (loading || !session?.user?.approved)
    return <WorkspaceAccess session={session} loading={loading} error={error} refresh={refresh} />;
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
