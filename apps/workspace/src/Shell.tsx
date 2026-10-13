import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import {
  Activity,
  CalendarDays,
  Check,
  CircleHelp,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  Search,
  Settings,
  Bell,
  Users,
} from "lucide-react";
import { DEPARTMENTS } from "@moc/shared";
import { useWorkspace } from "@moc/client";
import { Button, Modal } from "@moc/ui";
import "./styles.css";

const mainNav = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard },
  { label: "Departments", href: "/departments", icon: Users },
  {
    label: "Request inbox",
    href: "/requests",
    icon: ClipboardList,
    cell0: true,
  },
  { label: "Calendar", href: "/calendar", icon: CalendarDays },
  { label: "Reports", href: "/reports", icon: Activity, cell0: true },
];

function BrandMark() {
  return (
    <svg viewBox="0 0 42 42" aria-hidden="true" className="brand-mark">
      <path
        d="M6 35h30M10 32V15l11-7 11 7v17M15 32V17m6 15V15m6 17V17M8 15l13-9 13 9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M18 6h6" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export default function Shell({ children }: { children: ReactNode }) {
  const { state, user, demo, loading, error, act, logout, refresh } =
    useWorkspace();
  const [actionError, setActionError] = useState("");
  const [notificationError, setNotificationError] = useState("");
  const [markingRead, setMarkingRead] = useState(false);
  const location = useLocation();
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [search, setSearch] = useState("");
  const canSeeAll = user?.department === "cell-0";
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
  const date = new Intl.DateTimeFormat("en-ZA", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date());

  const onSearch = (event: FormEvent) => {
    event.preventDefault();
    if (search.trim())
      window.location.href = `/departments?q=${encodeURIComponent(search.trim())}`;
  };

  return (
    <div className="workspace-shell">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="MOC Workspace home">
          <BrandMark />
          <span className="brand-copy">
            <strong>MOC</strong>
            <small>WORKSPACE</small>
          </span>
        </a>
        <div className="sidebar-label">WORKSPACE</div>
        <nav className="side-nav" aria-label="Main navigation">
          {mainNav
            .filter((item) => !item.cell0 || canSeeAll)
            .map(({ label, href, icon: Icon }) => {
              const active =
                href === "/"
                  ? location.pathname === "/"
                  : location.pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  to={href}
                  className={`nav-item ${active ? "active" : ""}`}
                >
                  <Icon size={18} strokeWidth={1.8} />
                  <span>{label}</span>
                  {label === "Request inbox" && inboxCount > 0 && (
                    <span className="nav-count">{inboxCount}</span>
                  )}
                </Link>
              );
            })}
        </nav>
        <div className="sidebar-spacer" />
        <Link
          to="/settings"
          className={`nav-item ${location.pathname.startsWith("/settings") ? "active" : ""}`}
        >
          <Settings size={18} strokeWidth={1.8} />
          <span>Settings</span>
        </Link>
        <div className="sidebar-note">
          <div className="sidebar-note-icon">
            <CircleHelp size={17} />
          </div>
          <strong>Need a hand?</strong>
          <p>A quick guide to the workspace and how requests move.</p>
          <button
            type="button"
            className="guide-link"
            onClick={() => setGuideOpen(true)}
          >
            View the guide <span aria-hidden="true">↗</span>
          </button>
        </div>
        {demo && (
          <div className="demo-pill">
            <span />
            Demo environment
          </div>
        )}
        <div className="profile-card">
          <div className="avatar">{user ? initials(user.name) : "M"}</div>
          <div className="profile-copy">
            <strong>{user?.name ?? "Workspace user"}</strong>
            <span>
              {user?.rank ?? "Leader"} ·{" "}
              {DEPARTMENTS.find(
                (department) => department.id === user?.department,
              )?.name ?? "MOC"}
            </span>
          </div>
          <button
            className="profile-menu"
            type="button"
            onClick={() => {
              void logout().catch((error) =>
                setActionError(
                  error instanceof Error
                    ? error.message
                    : "Could not sign out.",
                ),
              );
            }}
            aria-label="Sign out"
          >
            <LogOut size={16} />
          </button>
        </div>
      </aside>
      <main className="main-panel">
        <header className="topbar">
          <button
            className="mobile-brand"
            aria-label="Open navigation"
            onClick={() => setNavigationOpen(true)}
          >
            <BrandMark />
          </button>
          <div className="topbar-date">
            <span>{date}</span>
          </div>
          <div className="topbar-actions">
            <form className="global-search" onSubmit={onSearch}>
              <Search size={17} />
              <input
                aria-label="Search tasks"
                placeholder="Search tasks…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <kbd>↵</kbd>
            </form>
            <button
              className="notification-trigger"
              type="button"
              aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
              onClick={() => setNotificationsOpen(true)}
            >
              <Bell size={18} />
              {unread > 0 && <i />}
            </button>
            <button
              className="top-avatar"
              type="button"
              onClick={() => {
                window.location.href = "/settings";
              }}
              aria-label="Open settings"
            >
              {user ? initials(user.name) : "M"}
            </button>
          </div>
        </header>
        {demo && (
          <div className="demo-banner">
            <span>DEMO</span> Sample data is editable and changes are saved in
            this local demo workspace.
          </div>
        )}
        <div className="page-content">
          {(error || actionError) && (
            <div role="alert" className="connection-error">
              {actionError || error}
              <button
                className="button button-secondary"
                onClick={() => {
                  setActionError("");
                  void refresh();
                }}
              >
                Retry
              </button>
            </div>
          )}
          {loading ? (
            <div className="loading-card">Loading your team’s work…</div>
          ) : (
            children
          )}
        </div>
      </main>
      <nav className="mobile-nav" aria-label="Mobile navigation">
        {mainNav
          .filter((item) => !item.cell0 || canSeeAll)
          .filter((item) =>
            ["Dashboard", "Departments", "Request inbox", "Calendar"].includes(
              item.label,
            ),
          )
          .map(({ label, href, icon: Icon }) => (
            <Link
              key={href}
              to={href}
              className={
                (
                  href === "/"
                    ? location.pathname === "/"
                    : location.pathname.startsWith(href)
                )
                  ? "active"
                  : ""
              }
            >
              <Icon size={17} />
              <span>{label === "Request inbox" ? "Inbox" : label}</span>
            </Link>
          ))}
      </nav>
      <Modal
        open={navigationOpen}
        onClose={() => setNavigationOpen(false)}
        title="Your workspace"
      >
        <nav className="mobile-menu" aria-label="All workspace pages">
          {mainNav
            .filter((item) => !item.cell0 || canSeeAll)
            .map(({ label, href, icon: Icon }) => (
              <Link
                key={href}
                to={href}
                className="nav-item"
                onClick={() => setNavigationOpen(false)}
              >
                <Icon size={18} />
                {label}
              </Link>
            ))}
          <Link
            to="/settings"
            className="nav-item"
            onClick={() => setNavigationOpen(false)}
          >
            <Settings size={18} />
            Settings
          </Link>
          {canSeeAll && (
            <Link
              to="/departments/cell-0"
              className="nav-item"
              onClick={() => setNavigationOpen(false)}
            >
              Cell 0 private work
            </Link>
          )}
        </nav>
      </Modal>
      <Modal
        open={notificationsOpen}
        onClose={() => setNotificationsOpen(false)}
        title="Notifications"
      >
        <div className="notification-list">
          {visibleNotifications.length ? (
            visibleNotifications
              .slice()
              .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
              .map((item) => (
                <div
                  className={`notification-row ${item.read ? "" : "unread"}`}
                  key={item.id}
                >
                  <span className="notification-dot" />
                  <div>
                    <p>{item.text}</p>
                    <small>
                      {new Intl.DateTimeFormat("en", {
                        dateStyle: "medium",
                      }).format(new Date(item.createdAt))}
                    </small>
                  </div>
                </div>
              ))
          ) : (
            <div className="empty-state">You’re all caught up.</div>
          )}
        </div>
        {notificationError && (
          <p role="alert" className="connection-error">
            {notificationError}
          </p>
        )}
        <div className="modal-actions">
          <Button variant="ghost" onClick={() => setNotificationsOpen(false)}>
            Close
          </Button>
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
        </div>
      </Modal>
      <Modal
        open={guideOpen}
        onClose={() => setGuideOpen(false)}
        title="A quick guide to MOC"
      >
        <div className="guide-content">
          <p>
            Use your workspace to keep creative ministry work visible,
            organized, and moving.
          </p>
          <ol>
            <li>
              <strong>Review requests</strong>
              <span>
                Cell 0 checks new requests and routes approved work to a
                department.
              </span>
            </li>
            <li>
              <strong>Follow team progress</strong>
              <span>
                Departments update task progress as work moves through
                production.
              </span>
            </li>
            <li>
              <strong>Keep an eye on deadlines</strong>
              <span>
                The calendar and dashboard highlight what is coming up next.
              </span>
            </li>
          </ol>
          <Button variant="primary" onClick={() => setGuideOpen(false)}>
            Got it
          </Button>
        </div>
      </Modal>
    </div>
  );
}
