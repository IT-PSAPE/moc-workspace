import { useMemo, useState, type ReactNode } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import {
  Activity,
  AlertTriangle,
  CalendarDays,
  Check,
  CheckCheck,
  ClipboardList,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  Settings,
  Bell,
  PanelLeft,
  PanelLeftClose,
  ArrowUpRight,
  Users,
  ChevronRight,
} from "lucide-react";
import { useWorkspace } from "@moc/client";
import { Button, Dropdown, Modal, Tooltip, TooltipProvider } from "@moc/ui";
import { SidebarDepartmentNavMenu } from "./SidebarDepartmentNavMenu";
import "./styles.css";
import "./shell-overlays.css";
import "./department-colors.css";

const mainNav = [
  { label: "Overview", href: "/", icon: LayoutDashboard },
  { label: "Departments", href: "/departments", icon: Users },
  {
    label: "Requests",
    href: "/requests",
    icon: ClipboardList,
    cell0: true,
  },
  { label: "Work", href: "/calendar", icon: CalendarDays },
  { label: "Reports", href: "/reports", icon: Activity, cell0: true },
  { label: "Settings", href: "/settings", icon: Settings },
];
function initials(name: string) {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export default function Shell({ children }: { children: ReactNode }) {
  const { state, user, loading, initialError, error, act, logout, refresh } =
    useWorkspace();
  const [actionError, setActionError] = useState("");
  const [notificationError, setNotificationError] = useState("");
  const [markingRead, setMarkingRead] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [detailsCollapsed, setDetailsCollapsed] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const { pathname } = useLocation();
  const departments = state.catalog.departments;
  const canSeeAll = user?.department === "cell-0" && user.isLeader;
  const inboxCount =
    state?.requests.filter((request) => request.status === "pending").length ??
    0;
  const visibleNotifications = useMemo(
    () =>
      (state?.notifications ?? []).filter(
        (item) => canSeeAll || item.department === user?.department,
      ),
    [state?.notifications, canSeeAll, user?.department],
  );
  const unread = visibleNotifications.filter((item) => !item.read).length;
  const navigation = mainNav.filter(
    (item) =>
      !item.cell0 || canSeeAll || (item.href === "/requests" && user?.isLeader),
  );
  const active = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);
  const sectionTitle =
    navigation.find((item) => active(item.href))?.label ?? "Settings";
  const hasSecondary = pathname.startsWith("/departments");
  function signOut() {
    void logout().catch((error: unknown) =>
      setActionError(
        error instanceof Error ? error.message : "Could not sign out.",
      ),
    );
  }
  function closeNavigation() {
    setNavigationOpen(false);
  }

  return (
    <TooltipProvider>
      <div className="workspace-shell">
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        <nav className="sidebar-rail" aria-label="Main navigation">
          {navigation.map(({ label, href, icon: Icon }) => (
            <Tooltip key={href} label={label}>
              <Link
                to={href}
                className={`rail-item ${active(href) ? "active" : ""}`}
                aria-label={label}
                aria-description={
                  href === "/requests" && inboxCount > 0
                    ? `${inboxCount} pending requests`
                    : undefined
                }
                aria-current={active(href) ? "page" : undefined}
              >
                <Icon size={20} strokeWidth={1.8} aria-hidden="true" />
                {href === "/requests" && inboxCount > 0 && (
                  <i className="rail-unread-dot" aria-hidden="true" />
                )}
              </Link>
            </Tooltip>
          ))}
          <div className="rail-footer">
            <Tooltip label="Notifications">
              <button
                className="rail-item notification-trigger"
                type="button"
                aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
                onClick={() => setNotificationsOpen(true)}
              >
                <Bell size={19} aria-hidden="true" />
                {unread > 0 && <i />}
              </button>
            </Tooltip>
            <Tooltip label="Quick guide">
              <button
                type="button"
                className="rail-item"
                aria-label="Quick guide"
                onClick={() => setGuideOpen(true)}
              >
                <LifeBuoy size={19} aria-hidden="true" />
              </button>
            </Tooltip>
            <Dropdown.Root>
              <Dropdown.Trigger
                className="rail-item rail-profile"
                aria-label="Workspace account menu"
              >
                {initials(user?.name ?? "MOC")}
              </Dropdown.Trigger>
              <Dropdown.Content>
                <div className="account-menu-heading">
                  <strong>{user?.name}</strong>
                  <span>
                    {user?.duty ?? "Member"} ·{" "}
                    {departments.find(
                      (department) => department.id === user?.department,
                    )?.name ?? "MOC"}
                  </span>
                </div>
                <Dropdown.Item
                  nativeButton={false}
                  render={<Link to="/settings" />}
                >
                  <Settings size={16} />
                  Settings
                </Dropdown.Item>
                <Dropdown.Item
                  nativeButton={false}
                  render={
                    <a
                      href={
                        import.meta.env.VITE_PORTAL_URL ||
                        "http://localhost:5174"
                      }
                      target="_blank"
                      rel="noreferrer"
                    />
                  }
                >
                  <ArrowUpRight size={16} />
                  Request portal
                </Dropdown.Item>
                <Dropdown.Item onClick={signOut}>
                  <LogOut size={16} />
                  Sign out
                </Dropdown.Item>
              </Dropdown.Content>
            </Dropdown.Root>
          </div>
        </nav>
        <div className="workspace-surface">
          {hasSecondary && !detailsCollapsed && (
            <aside className="sidebar" aria-label="Department navigation">
              <div className="sidebar-header">
                <span className="workspace-avatar">M</span>
                <strong>MOC Workspace</strong>
                <button
                  className="icon-button"
                  type="button"
                  aria-label="Collapse department navigation"
                  onClick={() => setDetailsCollapsed(true)}
                >
                  <PanelLeftClose size={16} />
                </button>
              </div>
              <nav className="side-nav" aria-label="Departments">
                <span className="nav-group-label">Departments</span>
                <Link
                  className={`nav-item ${pathname === "/departments" ? "active" : ""}`}
                  to="/departments"
                  activeOptions={{ exact: true }}
                >
                  <Users size={17} />
                  All departments
                </Link>
                {departments
                  .filter(
                    (department) => department.id !== "cell-0" || canSeeAll,
                  )
                  .map((department) => (
                    <SidebarDepartmentNavMenu
                      key={department.id}
                      department={department}
                    >
                      <Link
                        className={`nav-item ${pathname === `/departments/${department.id}` ? "active" : ""}`}
                        to={`/departments/${department.id}`}
                      >
                        <span
                          className="department-dot"
                          data-dept={department.id}
                          data-department-color={department.color}
                        />
                        {department.name}
                        {department.id === "cell-0" && <small>Private</small>}
                      </Link>
                    </SidebarDepartmentNavMenu>
                  ))}
              </nav>
            </aside>
          )}
          <main className="main-panel">
            <header
              className={`topbar ${hasSecondary && detailsCollapsed ? "has-expand" : ""}`}
            >
              <button
                className="icon-button mobile-navigation-trigger"
                type="button"
                aria-label="Open navigation"
                onClick={() => setNavigationOpen(true)}
              >
                <PanelLeft size={18} />
              </button>
              {hasSecondary && detailsCollapsed && (
                <button
                  className="icon-button expand-navigation-trigger"
                  type="button"
                  aria-label="Expand department navigation"
                  onClick={() => setDetailsCollapsed(false)}
                >
                  <PanelLeft size={18} />
                </button>
              )}
              <span className="mobile-section-title">{sectionTitle}</span>
              <button
                className="icon-button mobile-notification-trigger"
                type="button"
                aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
                onClick={() => setNotificationsOpen(true)}
              >
                <Bell size={18} />
              </button>
            </header>
            <div className="page-content" id="main-content" tabIndex={-1}>
              {(error || actionError) && (
                <div role="alert" className="connection-error">
                  <div className="connection-error-copy">
                    <AlertTriangle size={18} aria-hidden="true" />
                    <span>{actionError || error}</span>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => {
                      setActionError("");
                      void refresh();
                    }}
                  >
                    Retry
                  </Button>
                </div>
              )}
              {initialError ? (
                <div className="workspace-load-error">
                  <h1>Your work couldn’t load</h1>
                  <p>Retry the connection to continue.</p>
                </div>
              ) : loading ? (
                <div className="loading-card" role="status" aria-live="polite">
                  <span className="loading-spinner" aria-hidden="true" />
                  <p>Loading your team’s work…</p>
                </div>
              ) : (
                children
              )}
            </div>
          </main>
        </div>
        <Modal
          open={navigationOpen}
          onClose={closeNavigation}
          title="MOC Workspace"
          className="navigation-drawer p-3"
          side="left"
        >
          <nav className="mobile-menu" aria-label="All workspace pages">
            {navigation.map(({ label, href, icon: Icon }) => (
              <Link
                key={href}
                to={href}
                className={`nav-item ${active(href) ? "active" : ""}`}
                onClick={closeNavigation}
              >
                <Icon size={19} />
                {label}
                <ChevronRight size={15} className="nav-chevron" />
                {href === "/requests" && inboxCount > 0 && (
                  <i
                    className="nav-unread-dot"
                    aria-label={`${inboxCount} pending requests`}
                  />
                )}
              </Link>
            ))}
            <div className="mobile-departments">
              <span className="nav-group-label">Departments</span>
              {departments
                .filter((department) => department.id !== "cell-0" || canSeeAll)
                .map((department) => (
                  <SidebarDepartmentNavMenu
                    key={department.id}
                    department={department}
                  >
                    <Link
                      className="nav-item"
                      to={`/departments/${department.id}`}
                      onClick={closeNavigation}
                    >
                      <span
                        className="department-dot"
                        data-dept={department.id}
                        data-department-color={department.color}
                      />
                      {department.name}
                    </Link>
                  </SidebarDepartmentNavMenu>
                ))}
            </div>
            <a
              href={import.meta.env.VITE_PORTAL_URL || "http://localhost:5174"}
              className="nav-item"
            >
              <ArrowUpRight size={19} />
              Request portal
            </a>
            <button
              type="button"
              className="nav-item"
              onClick={() => {
                closeNavigation();
                setGuideOpen(true);
              }}
            >
              <LifeBuoy size={19} />
              Quick guide
            </button>
            <button type="button" className="nav-item" onClick={signOut}>
              <LogOut size={19} />
              Sign out
            </button>
          </nav>
        </Modal>
        <Modal
          open={notificationsOpen}
          onClose={() => setNotificationsOpen(false)}
          title="Notifications"
          className="notifications-modal"
        >
          <div
            className="flex max-h-[min(50dvh,420px)] flex-col overflow-y-auto"
            role="list"
            aria-label="Notifications"
          >
            {visibleNotifications.length ? (
              visibleNotifications
                .slice()
                .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                .map((item) => (
                  <div
                    className={`flex items-start gap-2.5 border-b border-[var(--line)] px-4 py-3 ${item.read ? "" : "bg-[var(--surface-sunken)]"}`}
                    key={item.id}
                    role="listitem"
                  >
                    <span
                      className={`mt-1.5 size-[7px] shrink-0 rounded-full ${item.read ? "bg-transparent" : "bg-[var(--brand-500)]"}`}
                      aria-hidden="true"
                    />
                    <div className="min-w-0">
                      <p className="m-0 break-words text-sm leading-5">{item.text}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs leading-4 text-[var(--muted)]">
                        <span
                          className={`font-semibold ${item.read ? "" : "text-[var(--brand-700)]"}`}
                        >
                          {item.read ? "Read" : "Unread"}
                        </span>
                        <time className="text-[var(--muted)]" dateTime={item.createdAt}>
                          {new Intl.DateTimeFormat("en", {
                            dateStyle: "medium",
                          }).format(new Date(item.createdAt))}
                        </time>
                      </div>
                    </div>
                  </div>
                ))
            ) : (
              <div className="flex flex-col items-center gap-1.5 py-4 text-center text-sm leading-5 text-[var(--muted)]">
                <CheckCheck size={20} className="text-[var(--success-solid)]" aria-hidden="true" />
                <p className="m-0">You’re all caught up.</p>
              </div>
            )}
          </div>
          {notificationError && (
            <div
              role="alert"
              className="mt-2.5 flex items-center gap-3 rounded-lg border border-[var(--danger-border)] bg-[var(--danger-bg)] p-3 text-sm leading-5 text-[var(--danger-text)]"
            >
              <div className="flex min-w-0 items-center gap-2">
                <AlertTriangle size={18} className="shrink-0" aria-hidden="true" />
                <span>{notificationError}</span>
              </div>
            </div>
          )}
          <div className="mt-3 flex flex-none items-center justify-end gap-2 border-t border-[var(--line)] pt-3">
            <Button variant="ghost" onClick={() => setNotificationsOpen(false)}>
              Close
            </Button>
            {unread > 0 && (
              <Button
                variant="primary"
                disabled={markingRead}
                onClick={() => {
                  setNotificationError("");
                  setMarkingRead(true);
                  void act({ type: "read-notifications" })
                    .then(() => setNotificationsOpen(false))
                    .catch((error) =>
                      setNotificationError(
                        error instanceof Error
                          ? error.message
                          : "Could not mark notifications as read.",
                      ),
                    )
                    .finally(() => setMarkingRead(false));
                }}
              >
                <Check size={15} /> Mark all as read
              </Button>
            )}
          </div>
        </Modal>
        <Modal
          open={guideOpen}
          onClose={() => setGuideOpen(false)}
          title="A quick guide to MOC"
          className="quick-guide-modal"
        >
          <div className="flex flex-col gap-4">
            <p className="m-0 text-sm leading-5 text-[var(--muted)]">
              Use your workspace to keep creative ministry work visible,
              organized, and moving.
            </p>
            <ol className="m-0 flex list-decimal flex-col gap-3.5 pl-5">
              <li className="pl-1">
                <strong className="block text-sm font-semibold leading-5">Review requests</strong>
                <span className="mt-0.5 block text-[13px] leading-[18px] text-[var(--muted)]">
                  Cell 0 checks new requests and routes approved work to a
                  department.
                </span>
              </li>
              <li className="pl-1">
                <strong className="block text-sm font-semibold leading-5">Follow team progress</strong>
                <span className="mt-0.5 block text-[13px] leading-[18px] text-[var(--muted)]">
                  Departments update task progress as work moves through
                  production.
                </span>
              </li>
              <li className="pl-1">
                <strong className="block text-sm font-semibold leading-5">Keep an eye on deadlines</strong>
                <span className="mt-0.5 block text-[13px] leading-[18px] text-[var(--muted)]">
                  The calendar and dashboard highlight what is coming up next.
                </span>
              </li>
            </ol>
            <Button className="self-start" variant="primary" onClick={() => setGuideOpen(false)}>
              Got it
            </Button>
          </div>
        </Modal>
      </div>
    </TooltipProvider>
  );
}
