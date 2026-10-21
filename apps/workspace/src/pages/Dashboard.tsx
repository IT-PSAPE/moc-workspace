import { lazy, Suspense } from "react";
import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Clapperboard,
  Clock3,
  FolderOpen,
  ListChecks,
  Music2,
  Palette,
  Quote,
} from "lucide-react";
import { useWorkspace } from "@moc/client";
import { Badge, Button } from "@moc/ui";
import "./dashboard.css";

const PulseChart = lazy(() => import("./PulseChart"));

const departmentIcons: Record<string, typeof Music2> = {
  sound: Music2,
  "visual-media": Clapperboard,
  design: Palette,
};
function formatDay(value: string) {
  return new Intl.DateTimeFormat("en-ZA", {
    day: "numeric",
    month: "short",
  }).format(new Date(value));
}

function isSameMonth(value: string, from: Date) {
  const date = new Date(value);
  return (
    date.getFullYear() === from.getFullYear() &&
    date.getMonth() === from.getMonth()
  );
}

function shortRelative(value: string) {
  const diff = Math.floor(
    (Date.now() - new Date(value).getTime()) / 86_400_000,
  );
  if (diff < 1) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 7) return `${diff} days ago`;
  return formatDay(value);
}

export default function Dashboard() {
  const { state, user } = useWorkspace();
  const tasks = state?.tasks ?? [];
  const departments = state?.catalog?.departments ?? [];
  const departmentsById = new Map(
    departments.map((department) => [department.id, department]),
  );
  const departmentName = (id: string) => departmentsById.get(id)?.name ?? id;
  const productionDepartments = departments.filter(
    (department) => department.id !== "cell-0",
  );
  const requests = state?.requests ?? [];
  const activities = state?.activities ?? [];
  const now = new Date();
  const firstName = user?.name.trim().split(/\s+/)[0];
  const greeting =
    now.getHours() < 12
      ? "Good morning"
      : now.getHours() < 18
        ? "Good afternoon"
        : "Good evening";
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);
  const overdueTasks = tasks.filter(
    (task) =>
      task.status !== "completed" && Date.parse(task.dueAt) < now.getTime(),
  );
  const dueWeek = tasks.filter(
    (task) =>
      task.status !== "completed" &&
      Date.parse(task.dueAt) >= weekStart.getTime() &&
      Date.parse(task.dueAt) <= weekEnd.getTime(),
  );
  const doneMonth = tasks.filter(
    (task) =>
      task.status === "completed" &&
      task.completedAt &&
      isSameMonth(task.completedAt, now),
  );
  const pendingRequests = requests.filter(
    (request) => request.status === "pending",
  ).length;
  const departmentTasks = (id: string) =>
    tasks.filter((task) => task.department === id);
  const upcoming = tasks
    .filter(
      (task) =>
        task.status !== "completed" && Date.parse(task.dueAt) >= now.getTime(),
    )
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt))
    .slice(0, 4);
  const activeTasks = tasks
    .filter((task) => task.status !== "completed")
    .sort((a, b) => b.progress - a.progress)
    .slice(0, 3);
  const nextDeadlineTask = upcoming[0];
  const chartData = Array.from({ length: 8 }, (_, i) => {
    const month = new Date(now.getFullYear(), now.getMonth() - (7 - i), 1);
    return tasks.filter(
      (task) =>
        task.status === "completed" &&
        task.completedAt &&
        isSameMonth(task.completedAt, month),
    ).length;
  });
  const chartMonths = Array.from({ length: 8 }, (_, i) =>
    new Intl.DateTimeFormat("en", { month: "short", year: "numeric" }).format(
      new Date(now.getFullYear(), now.getMonth() - (7 - i), 1),
    ),
  );
  return (
    <div className="dashboard-page">
      <header className="flex min-w-0 items-center justify-between gap-4 max-[767px]:flex-col max-[767px]:items-start">
        <div className="min-w-0">
          <h1 className="m-0 text-2xl leading-tight font-semibold tracking-[-0.02em] [overflow-wrap:anywhere] max-[767px]:text-xl">
            {greeting}{firstName ? `, ${firstName}` : ""}
          </h1>
          <p className="mt-1 mb-0 text-sm leading-5 text-[var(--muted)]">
            Welcome back to MOC Workspace
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 max-[767px]:w-full max-[767px]:flex-wrap max-[767px]:[&>.button]:flex-1">
          <Button
            variant="secondary"
            onClick={() => {
              window.location.href = "/calendar";
            }}
          >
            <CalendarDays size={16} /> View calendar
          </Button>
          {user?.department === "cell-0" && (
            <Button
              variant="primary"
              onClick={() => {
                window.location.href = "/requests";
              }}
            >
              <FolderOpen size={16} /> Review requests
            </Button>
          )}
        </div>
      </header>

      <aside aria-label="Workspace inspiration" className="relative flex min-h-24 overflow-hidden rounded-[var(--radius-lg)] border border-solid border-[var(--line)] bg-[var(--surface)]">
        <div className="z-[1] flex w-16 shrink-0 items-center justify-center bg-[var(--brand-50)] text-[var(--brand-700)] max-[767px]:w-12">
          <Quote size={26} strokeWidth={1.5} aria-hidden="true" />
        </div>
        <figure className="relative z-[1] m-0 min-w-0 flex-1 px-5 py-5 sm:pr-44 max-[767px]:px-4 max-[767px]:py-4">
          <blockquote className="m-0 text-lg leading-7 font-medium italic max-[767px]:text-base max-[767px]:leading-6">
            “Fulfil your duty with faith and excellence.”
          </blockquote>
          <figcaption className="mt-1 text-xs leading-4 text-[var(--muted)]">
            — Chairman Man-Hee Lee
          </figcaption>
        </figure>
        <svg
          className="pointer-events-none absolute inset-y-0 right-0 hidden h-full w-56 text-[var(--ink-secondary)] opacity-[0.12] sm:block"
          viewBox="0 0 224 112"
          fill="none"
          aria-hidden="true"
          focusable="false"
        >
          <defs>
            <linearGradient id="overview-column-fade">
              <stop stopColor="white" stopOpacity="0" />
              <stop offset="0.55" stopColor="white" />
            </linearGradient>
            <mask id="overview-column-mask">
              <rect width="224" height="112" fill="url(#overview-column-fade)" />
            </mask>
          </defs>
          <g mask="url(#overview-column-mask)" stroke="currentColor" strokeWidth="1.5">
            <path d="M-12 36 224-18M-12 43 224-11M-12 50 224-4" />
            {[18, 84, 150, 216].map((x) => (
              <g key={x} transform={`translate(${x} ${-x * 0.23 + 44})`}>
                <path d="M-6-7H40V0H-6ZM-2 0H36L32 7H2ZM2 7H32L30 112H4ZM-2 112H36V118H-2" fill="currentColor" fillOpacity="0.12" />
                <path d="M8 10 9 109M16 10V109M25 10 24 109" />
              </g>
            ))}
          </g>
        </svg>
      </aside>

      <section className="dashboard-stats" aria-label="Workspace statistics">
        <article className="dashboard-stat">
          <div className="dashboard-stat-label">
            <Clock3 size={16} /> Due this week
          </div>
          <div className="dashboard-stat-value">
            {dueWeek.length}
            <span>tasks</span>
          </div>
        </article>
        <article className="dashboard-stat">
          <div className="dashboard-stat-label">
            <CheckCircle2 size={16} /> Completed this month
          </div>
          <div className="dashboard-stat-value">
            {doneMonth.length}
            <span>tasks</span>
          </div>
        </article>
        <article
          className={`dashboard-stat ${overdueTasks.length ? "is-overdue" : ""}`}
        >
          <div className="dashboard-stat-label">
            <AlertTriangle size={16} /> Overdue
          </div>
          <div className="dashboard-stat-value">
            {overdueTasks.length}
            <span>tasks</span>
          </div>
        </article>
        <article className="dashboard-stat">
          <div className="dashboard-stat-label">
            <ListChecks size={16} /> Pending tasks
          </div>
          <div className="dashboard-stat-value">
            {tasks.filter((task) => task.status === "pending").length}
            <span>tasks</span>
          </div>
          {user?.department === "cell-0" && pendingRequests > 0 ? (
            <Link to="/requests" className="dashboard-stat-link">
              {pendingRequests} requests to review <ArrowRight size={14} />
            </Link>
          ) : null}
        </article>
      </section>

      <div className="dashboard-layout">
        <div className="dashboard-primary">
          <section className="dashboard-section">
            <div className="dashboard-section-heading">
              <div>
                <h2>Departments</h2>
              </div>
              <Link to="/departments" className="dashboard-text-link">
                All departments <ArrowRight size={15} />
              </Link>
            </div>
            <div className="dashboard-departments">
              {productionDepartments.map((department) => {
                const items = departmentTasks(department.id);
                const inProgress = items.filter(
                  (task) => task.status === "in-progress",
                ).length;
                const completed = items.filter(
                  (task) => task.status === "completed",
                ).length;
                const active = items.filter(
                  (task) => task.status !== "completed",
                ).length;
                const progress = items.length
                  ? Math.round(
                      items.reduce((total, task) => total + task.progress, 0) /
                        items.length,
                    )
                  : 0;
                const Icon = departmentIcons[department.id] ?? FolderOpen;
                return (
                  <a
                    href={`/departments/${department.id}`}
                    key={department.id}
                    className="dashboard-department"
                    data-department-color={department.color}
                  >
                    <div className="dashboard-department-top">
                      <span className="dashboard-department-icon">
                        <Icon size={17} strokeWidth={1.8} />
                      </span>
                      <span className="dashboard-department-count">
                        {active} active
                      </span>
                    </div>
                    <h3>{department.name}</h3>
                    <div className="dashboard-department-meta">
                      <span>
                        {completed} completed · {inProgress} in progress
                      </span>
                      <b>{progress}%</b>
                    </div>
                    <div className="dashboard-progress">
                      <i style={{ width: `${progress}%` }} />
                    </div>
                  </a>
                );
              })}
            </div>
          </section>

          <section className="dashboard-section dashboard-projects">
            <div className="dashboard-section-heading">
              <div>
                <h2>Active work</h2>
              </div>
              <Link to="/departments" className="dashboard-text-link">
                View all <ArrowRight size={15} />
              </Link>
            </div>
            <div className="dashboard-project-list">
              {activeTasks.map((task) => {
                const Icon = departmentIcons[task.department] ?? FolderOpen;
                return (
                  <a
                    href={`/departments/${task.department}`}
                    className="dashboard-project-row"
                    data-department-color={
                      departmentsById.get(task.department)?.color
                    }
                    key={task.id}
                  >
                    <span className="dashboard-project-icon">
                      <Icon size={17} strokeWidth={1.8} />
                    </span>
                    <div className="dashboard-project-copy">
                      <strong>{task.title}</strong>
                      <span>
                        {task.ministry}
                        <i>·</i>
                        {task.subTeam}
                      </span>
                    </div>
                    <div className="dashboard-project-state">
                      <div className="dashboard-project-progress">
                        <div className="dashboard-progress">
                          <i style={{ width: `${task.progress}%` }} />
                        </div>
                        <small>{task.progress}%</small>
                      </div>
                      <Badge
                        tone="neutral"
                      >
                        {task.status === "pending"
                          ? "Not started"
                          : "In progress"}
                      </Badge>
                    </div>
                    <ArrowRight className="dashboard-row-arrow" size={15} />
                  </a>
                );
              })}
              {!activeTasks.length && (
                <div className="dashboard-empty">No active tasks.</div>
              )}
            </div>
          </section>

          <section className="dashboard-section dashboard-pulse">
            <div className="dashboard-section-heading">
              <div>
                <h2>Ministry pulse</h2>
                <p>Completed tasks · Past eight months</p>
              </div>
              <div className="dashboard-pulse-total">
                <strong>
                  {tasks.filter((task) => task.status === "completed").length}
                </strong>
                <span>total completed</span>
              </div>
            </div>
            <Suspense
              fallback={
                <div className="dashboard-chart-wrap" role="status">
                  Loading chart…
                </div>
              }
            >
              <PulseChart completed={chartData} months={chartMonths} />
            </Suspense>
          </section>
        </div>

        <aside className="dashboard-secondary">
          <section className="dashboard-section dashboard-focus">
            <div className="dashboard-section-heading">
              <div>
                <h2>Next deadline</h2>
              </div>
            </div>
            {nextDeadlineTask ? (
              <a
                href={`/departments/${nextDeadlineTask.department}`}
                className="dashboard-focus-task"
                data-department-color={
                  departmentsById.get(nextDeadlineTask.department)?.color
                }
              >
                <span className="dashboard-focus-label">
                  {Date.parse(nextDeadlineTask.dueAt) - now.getTime() <=
                  7 * 86_400_000
                    ? "Due this week"
                    : "Upcoming"}
                </span>
                <strong>{nextDeadlineTask.title}</strong>
                <span className="dashboard-focus-meta">
                  {departmentName(nextDeadlineTask.department)}
                  <i>·</i>
                  {nextDeadlineTask.subTeam}
                  <i>·</i>Due {formatDay(nextDeadlineTask.dueAt)}
                </span>
                <div className="dashboard-focus-progress">
                  <div className="dashboard-progress">
                    <i style={{ width: `${nextDeadlineTask.progress}%` }} />
                  </div>
                  <small>{nextDeadlineTask.progress}% complete</small>
                </div>
                <span className="dashboard-focus-open">
                  Open task <ArrowRight size={13} />
                </span>
              </a>
            ) : (
              <div className="dashboard-empty">
                No next deadline.
              </div>
            )}
          </section>

          <section className="dashboard-section dashboard-activity">
            <div className="dashboard-section-heading">
              <div>
                <h2>Recent activity</h2>
              </div>
            </div>
            <div className="dashboard-activity-list">
              {activities
                .slice()
                .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                .slice(0, 4)
                .map((activity) => (
                  <div className="dashboard-activity-item" key={activity.id}>
                    <span className="dashboard-activity-dot" />
                    <div>
                      <p>{activity.text}</p>
                      <span>
                        {shortRelative(activity.createdAt)}
                        <i>·</i>
                        {departmentName(activity.department)}
                      </span>
                    </div>
                  </div>
                ))}
              {!activities.length && (
                <div className="dashboard-empty">
                  No recent activity.
                </div>
              )}
            </div>
            <Link to="/departments" className="dashboard-panel-link">
              View team work <ArrowRight size={14} />
            </Link>
          </section>

          <section className="dashboard-section dashboard-deadlines">
            <div className="dashboard-section-heading">
              <div>
                <h2>Upcoming deadlines</h2>
              </div>
              <Link
                to="/calendar"
                className="dashboard-calendar-link"
                aria-label="Open calendar"
              >
                <CalendarDays size={16} />
              </Link>
            </div>
            <div className="dashboard-deadline-list">
              {upcoming.map((task) => (
                <a
                  href={`/departments/${task.department}`}
                  className="dashboard-deadline"
                  key={task.id}
                  data-department-color={
                    departmentsById.get(task.department)?.color
                  }
                >
                  <span className="dashboard-deadline-date">
                    <strong>{new Date(task.dueAt).getDate()}</strong>
                    <small>
                      {new Intl.DateTimeFormat("en", { month: "short" }).format(
                        new Date(task.dueAt),
                      )}
                    </small>
                  </span>
                  <span className="dashboard-deadline-copy">
                    <strong>{task.title}</strong>
                    <small>
                      {departmentName(task.department)}
                      <i>·</i>
                      {task.ministry}
                    </small>
                  </span>
                </a>
              ))}
              {!upcoming.length && (
                <div className="dashboard-empty">No upcoming deadlines.</div>
              )}
            </div>
            <Link to="/calendar" className="dashboard-panel-link">
              Open calendar <ArrowRight size={14} />
            </Link>
          </section>
        </aside>
      </div>
    </div>
  );
}
