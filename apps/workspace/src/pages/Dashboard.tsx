import { Link } from "@tanstack/react-router";
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  Clapperboard,
  Clock3,
  FolderOpen,
  MoreHorizontal,
  Music2,
  Palette,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { DEPARTMENTS } from "@moc/shared";
import { useWorkspace } from "@moc/client";
import { Badge, Button } from "@moc/ui";

const productionDepartments = DEPARTMENTS.filter(
  (department) => department.id !== "cell-0",
);
const departmentIcons: Record<string, typeof Music2> = {
  sound: Music2,
  "visual-media": Clapperboard,
  design: Palette,
};
const labels: Record<string, string> = {
  sound: "Sound",
  "visual-media": "Visual Media",
  design: "Design",
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

function PulseChart({
  completed,
  months,
}: {
  completed: number[];
  months: string[];
}) {
  const normalized = completed.map((value) =>
    Math.max(12, 88 - Math.min(value, 12) * 6),
  );
  const points = normalized.map((y, i) => `${i * 48},${y}`).join(" ");
  const area = `0,100 ${points} 336,100`;
  return (
    <div className="chart-wrap">
      <svg
        className="pulse-chart"
        viewBox="0 0 336 110"
        preserveAspectRatio="none"
        role="img"
        aria-label="Completed tasks over the last eight months"
      >
        <defs>
          <linearGradient id="pulseFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#789789" stopOpacity=".25" />
            <stop offset="1" stopColor="#789789" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path
          d="M0 27h336M0 63h336M0 99h336"
          stroke="#e9e7e0"
          strokeDasharray="3 5"
        />
        <polygon points={area} fill="url(#pulseFill)" />
        <polyline
          points={points}
          fill="none"
          stroke="#365f4d"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {normalized.map((y, i) => (
          <circle
            key={i}
            cx={i * 48}
            cy={y}
            r="3.5"
            fill="#fff"
            stroke="#365f4d"
            strokeWidth="2"
          />
        ))}
      </svg>
      <div className="chart-months">
        {months.map((month, i) => (
          <span key={`${month}-${i}`}>{month}</span>
        ))}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { state, user } = useWorkspace();
  const tasks = state?.tasks ?? [];
  const requests = state?.requests ?? [];
  const activities = state?.activities ?? [];
  const now = new Date();
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
  const name = user?.name?.split(" ")[0] ?? "there";
  const greeting =
    now.getHours() < 12
      ? "Good morning"
      : now.getHours() < 17
        ? "Good afternoon"
        : "Good evening";
  const departmentTasks = (id: string) =>
    tasks.filter((task) => task.department === id);
  const upcoming = tasks
    .filter(
      (task) =>
        task.status !== "completed" && Date.parse(task.dueAt) >= now.getTime(),
    )
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt))
    .slice(0, 4);
  const chartData = Array.from({ length: 8 }, (_, i) => {
    const month = new Date(now.getFullYear(), now.getMonth() - (7 - i), 1);
    return tasks.filter(
      (task) => task.completedAt && isSameMonth(task.completedAt, month),
    ).length;
  });
  const chartMonths = Array.from({ length: 8 }, (_, i) =>
    new Intl.DateTimeFormat("en", { month: "short" }).format(
      new Date(now.getFullYear(), now.getMonth() - (7 - i), 1),
    ),
  );

  return (
    <div className="dashboard-page">
      <div className="page-heading dashboard-heading">
        <div>
          <div className="eyebrow">
            MOC Workspace <span>·</span> Overview
          </div>
          <h1>
            {greeting}, {name}
          </h1>
          <p>Here’s what’s happening across your creative teams.</p>
        </div>
        <div className="heading-actions">
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
      </div>

      <section className="quote-banner">
        <div className="quote-copy">
          <div className="quote-kicker">
            <Sparkles size={16} /> A word to lead by
          </div>
          <blockquote>“Fulfil your duty with faith and excellence.”</blockquote>
          <span>Chairman Man-Hee Lee</span>
        </div>
      </section>

      <section className="stats-grid" aria-label="Workspace statistics">
        <article className="stat-card">
          <div className="stat-top">
            <span>Due this week</span>
            <span className="stat-icon icon-amber">
              <CalendarDays size={17} />
            </span>
          </div>
          <div className="stat-value">
            {dueWeek.length}
            <span className="stat-unit">tasks</span>
          </div>
          <div className="stat-foot">
            <span>
              {dueWeek.length
                ? "Keep an eye on these deadlines"
                : "Your week is looking clear"}
            </span>
            <ArrowUpRight size={14} />
          </div>
        </article>
        <article className="stat-card">
          <div className="stat-top">
            <span>Completed this month</span>
            <span className="stat-icon icon-green">
              <CheckCircle2 size={17} />
            </span>
          </div>
          <div className="stat-value">
            {doneMonth.length}
            <span className="stat-unit">tasks</span>
          </div>
          <div className="stat-foot positive">
            <TrendingUp size={14} />
            <span>Great work, team</span>
          </div>
        </article>
        <article
          className={`stat-card ${overdueTasks.length ? "stat-alert" : ""}`}
        >
          <div className="stat-top">
            <span>Overdue</span>
            <span
              className={`stat-icon ${overdueTasks.length ? "icon-red" : "icon-slate"}`}
            >
              <Clock3 size={17} />
            </span>
          </div>
          <div className="stat-value">
            {overdueTasks.length}
            <span className="stat-unit">tasks</span>
          </div>
          <div className="stat-foot">
            <span>
              {overdueTasks.length
                ? "Needs a little attention"
                : "Everything is on track"}
            </span>
            {overdueTasks.length ? (
              <ArrowDownRight size={14} />
            ) : (
              <CheckCircle2 size={14} />
            )}
          </div>
        </article>
        <article className="stat-card">
          <div className="stat-top">
            <span>Pending tasks</span>
            <span className="stat-icon icon-blue">
              <FolderOpen size={17} />
            </span>
          </div>
          <div className="stat-value">
            {tasks.filter((task) => task.status === "pending").length}
            <span className="stat-unit">tasks</span>
          </div>
          <div className="stat-foot">
            {user?.department === "cell-0" && pendingRequests > 0 ? (
              <Link to="/requests">
                {pendingRequests} requests to review <ArrowRight size={14} />
              </Link>
            ) : (
              <span>Ready to get underway</span>
            )}
          </div>
        </article>
      </section>

      <div className="dashboard-columns">
        <section className="departments-section">
          <div className="section-heading">
            <div>
              <div className="eyebrow">Your teams</div>
              <h2>Departments</h2>
            </div>
            <Link to="/departments" className="text-link">
              All departments <ArrowRight size={15} />
            </Link>
          </div>
          <div className="department-grid">
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
              return (
                <a
                  href={`/departments/${department.id}`}
                  key={department.id}
                  className="department-card"
                >
                  <div
                    className="department-symbol symbol-pink"
                    aria-hidden="true"
                  >
                    {(() => {
                      const Icon = departmentIcons[department.id] ?? FolderOpen;
                      return <Icon size={20} strokeWidth={1.9} />;
                    })()}
                  </div>
                  <div className="department-card-head">
                    <span className="department-overline">Department</span>
                    <span className="card-menu">
                      <MoreHorizontal size={18} />
                    </span>
                  </div>
                  <h3>{department.name}</h3>
                  <div className="department-counts">
                    <span>
                      <b>{active}</b> active
                    </span>
                    <span>
                      <b>{completed}</b> done
                    </span>
                  </div>
                  <div className="mini-progress">
                    <div>
                      <span>Overall progress</span>
                      <b>{progress}%</b>
                    </div>
                    <div className="progress-track">
                      <i style={{ width: `${progress}%` }} />
                    </div>
                  </div>
                  <div className="department-card-foot">
                    <span>
                      {inProgress
                        ? `${inProgress} in progress`
                        : "View department tasks"}
                    </span>
                    <ArrowRight size={15} />
                  </div>
                </a>
              );
            })}
          </div>
          <section className="projects-panel">
            <div className="section-heading compact">
              <div>
                <div className="eyebrow">In focus</div>
                <h2>Active projects</h2>
              </div>
              <Link to="/departments" className="text-link">
                View all <ArrowRight size={15} />
              </Link>
            </div>
            <div className="project-list">
              {tasks
                .filter((task) => task.status !== "completed")
                .sort((a, b) => b.progress - a.progress)
                .slice(0, 3)
                .map((task) => (
                  <a
                    href={`/departments/${task.department}`}
                    className="project-row"
                    key={task.id}
                  >
                    <span className="project-thumb" aria-hidden="true">
                      {(() => {
                        const Icon =
                          departmentIcons[task.department] ?? FolderOpen;
                        return <Icon size={20} strokeWidth={1.9} />;
                      })()}
                    </span>
                    <div className="project-meta">
                      <strong>{task.title}</strong>
                      <span>
                        {task.ministry} <i>·</i>{" "}
                        {labels[task.department] ?? task.department}
                      </span>
                      <div className="project-progress">
                        <div className="progress-track">
                          <i style={{ width: `${task.progress}%` }} />
                        </div>
                        <small>{task.progress}%</small>
                      </div>
                    </div>
                    <Badge
                      tone={
                        task.priority === "urgent" || task.priority === "high"
                          ? "gold"
                          : "neutral"
                      }
                    >
                      {task.status === "pending"
                        ? "Not started"
                        : "In progress"}
                    </Badge>
                    <ArrowRight className="project-arrow" size={16} />
                  </a>
                ))}
              {!tasks.some((task) => task.status !== "completed") && (
                <div className="empty-state">No active projects just yet.</div>
              )}
            </div>
          </section>
        </section>
        <aside className="right-column">
          <section className="side-panel focus-panel">
            <div className="section-heading compact">
              <div>
                <div className="eyebrow">Your focus</div>
                <h2>One thing at a time</h2>
              </div>
              <Sparkles size={16} className="focus-sparkle" />
            </div>
            {(() => {
              const focus = [...tasks]
                .filter((task) => task.status !== "completed")
                .sort(
                  (a, b) =>
                    (a.priority === "urgent"
                      ? -2
                      : a.priority === "high"
                        ? -1
                        : 0) -
                      (b.priority === "urgent"
                        ? -2
                        : b.priority === "high"
                          ? -1
                          : 0) || a.dueAt.localeCompare(b.dueAt),
                )[0];
              return focus ? (
                <a
                  href={`/departments/${focus.department}`}
                  className="focus-task"
                >
                  <span className="focus-task-label">Next up</span>
                  <strong>{focus.title}</strong>
                  <span>
                    {labels[focus.department] ?? focus.department} <i>·</i> Due{" "}
                    {formatDay(focus.dueAt)}
                  </span>
                  <div className="focus-progress">
                    <div className="progress-track">
                      <i style={{ width: `${focus.progress}%` }} />
                    </div>
                    <small>{focus.progress}% complete</small>
                  </div>
                  <span className="focus-open">
                    Open task <ArrowRight size={13} />
                  </span>
                </a>
              ) : (
                <div className="empty-state">
                  You’re all caught up. Take a breath.
                </div>
              );
            })()}
          </section>
          <section className="side-panel activity-panel">
            <div className="section-heading compact">
              <div>
                <div className="eyebrow">The latest</div>
                <h2>Recent activity</h2>
              </div>
              <MoreHorizontal
                size={18}
                className="activity-options-mark"
                aria-hidden="true"
              />
            </div>
            <div className="activity-list">
              {activities
                .slice()
                .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                .slice(0, 4)
                .map((activity) => (
                  <div className="activity-item" key={activity.id}>
                    <div className={`activity-icon activity-${activity.type}`}>
                      {activity.type === "completed" ? (
                        <CheckCircle2 size={15} />
                      ) : activity.type === "request" ? (
                        <FolderOpen size={15} />
                      ) : (
                        <Activity size={15} />
                      )}
                    </div>
                    <div className="activity-text">
                      <p>{activity.text}</p>
                      <span>
                        {shortRelative(activity.createdAt)} <i>·</i>{" "}
                        {labels[activity.department] ?? "Cell 0"}
                      </span>
                    </div>
                  </div>
                ))}
              {!activities.length && (
                <div className="empty-state">
                  Updates will show here as work progresses.
                </div>
              )}
            </div>
            <Link to="/departments" className="panel-link">
              View team work <ArrowRight size={14} />
            </Link>
          </section>
          <section className="side-panel deadlines-panel">
            <div className="section-heading compact">
              <div>
                <div className="eyebrow">Coming up</div>
                <h2>Upcoming deadlines</h2>
              </div>
              <Link
                to="/calendar"
                className="icon-button"
                aria-label="Open calendar"
              >
                <CalendarDays size={17} />
              </Link>
            </div>
            <div className="deadline-list">
              {upcoming.map((task) => (
                <a
                  href={`/departments/${task.department}`}
                  className="deadline-item"
                  key={task.id}
                >
                  <div className="deadline-date">
                    <strong>{new Date(task.dueAt).getDate()}</strong>
                    <span>
                      {new Intl.DateTimeFormat("en", { month: "short" }).format(
                        new Date(task.dueAt),
                      )}
                    </span>
                  </div>
                  <div className="deadline-copy">
                    <strong>{task.title}</strong>
                    <span>
                      {labels[task.department] ?? task.department} <i>·</i>{" "}
                      {task.ministry}
                    </span>
                  </div>
                  <span className="deadline-dot" />
                </a>
              ))}
              {!upcoming.length && (
                <div className="empty-state">No upcoming deadlines.</div>
              )}
            </div>
            <Link to="/calendar" className="panel-link">
              Open calendar <ArrowRight size={14} />
            </Link>
          </section>
        </aside>
      </div>
      <section className="pulse-panel">
        <div className="pulse-copy">
          <div className="eyebrow">A look back</div>
          <h2>Ministry pulse</h2>
          <p>Completed tasks over the past eight months.</p>
          <div className="pulse-total">
            <strong>
              {tasks.filter((task) => task.status === "completed").length}
            </strong>
            <span>total completed</span>
          </div>
        </div>
        <PulseChart completed={chartData} months={chartMonths} />
        <div className="pulse-aside">
          <span className="pulse-trend">
            <TrendingUp size={15} /> {doneMonth.length} this month
          </span>
          <span className="pulse-note">
            Every detail helps ministry move forward.
          </span>
        </div>
      </section>
    </div>
  );
}
