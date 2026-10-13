import { useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Clock3,
  MapPin,
  X,
} from "lucide-react";
import { Badge, Button, Modal } from "@moc/ui";
import { DEPARTMENTS, SERVICES, type Task } from "@moc/shared";
import { useWorkspace } from "@moc/client";
import "./workflows.css";

const fmtTime = (value: string) =>
  new Intl.DateTimeFormat("en-ZA", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
const fmtDate = (value: string) =>
  new Intl.DateTimeFormat("en-ZA", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(value));
const startOfDay = (value: string) => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
};
const keyFor = (date: Date) =>
  date.getFullYear() +
  "-" +
  String(date.getMonth() + 1).padStart(2, "0") +
  "-" +
  String(date.getDate()).padStart(2, "0");

export default function CalendarPage() {
  const { state, user, loading, error } = useWorkspace();
  const [month, setMonth] = useState(() => {
    const date = new Date();
    date.setDate(1);
    date.setHours(0, 0, 0, 0);
    return date;
  });
  const [selected, setSelected] = useState<Task | null>(null);
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const isCell0 = user?.department === "cell-0";
  const visibleTasks = useMemo(
    () =>
      (state?.tasks ?? []).filter(
        (task) => isCell0 || task.department === user?.department,
      ),
    [state, isCell0, user?.department],
  );
  const monthStart = new Date(month.getFullYear(), month.getMonth(), 1);
  const mondayOffset = (monthStart.getDay() + 6) % 7;
  const gridStart = new Date(monthStart);
  gridStart.setDate(monthStart.getDate() - mondayOffset);
  const daysInMonth = new Date(
    month.getFullYear(),
    month.getMonth() + 1,
    0,
  ).getDate();
  const dayCount = Math.ceil((mondayOffset + daysInMonth) / 7) * 7;
  const days = Array.from({ length: dayCount }, (_, index) => {
    const day = new Date(gridStart);
    day.setDate(gridStart.getDate() + index);
    return day;
  });
  const upcoming = useMemo(
    () =>
      [...visibleTasks]
        .filter(
          (task) =>
            task.status !== "completed" && Date.parse(task.dueAt) >= Date.now(),
        )
        .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt))
        .slice(0, 7),
    [visibleTasks],
  );
  const taskService = (task: Task) =>
    SERVICES.find((service) => service.id === task.service)?.name ??
    task.service;

  if (loading)
    return (
      <div className="workspace-page">
        <div className="workflow-skeleton" />
      </div>
    );
  if (!user?.approved)
    return (
      <div className="workspace-page">
        <section className="workflow-empty">
          <CalendarDays />
          <h2>Calendar access required</h2>
          <p>
            Sign in with an approved Cell 0 or department leader account to view
            deadlines.
          </p>
        </section>
      </div>
    );

  return (
    <div className="workspace-page workflow-page">
      <div className="page-header workflow-header">
        <div className="page-heading">
          <h1>Calendar</h1>
        </div>
        <div className="calendar-month-nav">
          <Button
            aria-label="Previous month"
            onClick={() =>
              setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))
            }
          >
            <ArrowLeft size={16} />
          </Button>
          <strong>
            {new Intl.DateTimeFormat("en-ZA", {
              month: "long",
              year: "numeric",
            }).format(month)}
          </strong>
          <Button
            aria-label="Next month"
            onClick={() =>
              setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))
            }
          >
            <ArrowRight size={16} />
          </Button>
        </div>
      </div>
      {error && (
        <div className="workflow-alert" role="alert">
          {error}
        </div>
      )}
      <div className="calendar-layout">
        <section className="calendar-card" aria-label="Task deadline calendar">
          <div className="calendar-weekdays">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>
          <div className="calendar-grid">
            {days.map((day) => {
              const dateKey = keyFor(day);
              const tasks = visibleTasks.filter(
                (task) => keyFor(new Date(task.dueAt)) === dateKey,
              );
              const isToday = keyFor(day) === keyFor(new Date());
              const isCurrentMonth = day.getMonth() === month.getMonth();
              return (
                <div
                  key={dateKey}
                  className={
                    "calendar-day " +
                    (!isCurrentMonth ? "outside-month " : "") +
                    (isToday ? "today " : "") +
                    (tasks.length === 0 ? "empty-day" : "")
                  }
                >
                  <span className="calendar-day-number">{day.getDate()}</span>
                  <div className="calendar-day-tasks">
                    {tasks
                      .slice(0, expandedDay === dateKey ? tasks.length : 3)
                      .map((task) => (
                        <button
                          key={task.id}
                          className={
                            "calendar-task calendar-task-" + task.status
                          }
                          onClick={() => setSelected(task)}
                          title={task.title}
                        >
                          <span className="calendar-task-time">
                            {fmtTime(task.dueAt)}
                          </span>
                          <span>{task.title}</span>
                        </button>
                      ))}
                    {tasks.length > 3 && (
                      <button
                        className="calendar-more"
                        aria-expanded={expandedDay === dateKey}
                        aria-label={`Show ${expandedDay === dateKey ? "fewer" : "all"} deadlines for ${dateKey}`}
                        onClick={() =>
                          setExpandedDay(
                            expandedDay === dateKey ? null : dateKey,
                          )
                        }
                      >
                        {expandedDay === dateKey
                          ? "Show less"
                          : `+${tasks.length - 3} more`}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {!visibleTasks.some((task) => {
            const due = new Date(task.dueAt);
            return (
              due.getMonth() === month.getMonth() &&
              due.getFullYear() === month.getFullYear()
            );
          }) && (
            <p className="calendar-mobile-empty">No deadlines this month.</p>
          )}
          <div className="calendar-legend">
            <span>
              <i className="legend-dot pending" /> Pending
            </span>
            <span>
              <i className="legend-dot progress" /> In progress
            </span>
            <span>
              <i className="legend-dot complete" /> Completed
            </span>
          </div>
        </section>
        <aside className="upcoming-card">
          <div className="upcoming-heading">
            <div>
              <h2>Next deadlines</h2>
            </div>
            <CalendarDays size={19} />
          </div>
          {upcoming.length > 0 ? (
            <div className="upcoming-list">
              {upcoming.map((task) => (
                <button
                  key={task.id}
                  className="upcoming-item"
                  onClick={() => setSelected(task)}
                >
                  <span className="upcoming-date">
                    <strong>
                      {new Intl.DateTimeFormat("en-ZA", {
                        day: "2-digit",
                      }).format(new Date(task.dueAt))}
                    </strong>
                    <small>
                      {new Intl.DateTimeFormat("en-ZA", {
                        month: "short",
                      }).format(new Date(task.dueAt))}
                    </small>
                  </span>
                  <span className="upcoming-task-copy">
                    <strong>{task.title}</strong>
                    <small>
                      {Array.from(
                        new Set([
                          DEPARTMENTS.find(
                            (department) => department.id === task.department,
                          )?.name,
                          task.subTeam,
                        ]),
                      )
                        .filter(Boolean)
                        .join(" · ")}
                    </small>
                  </span>
                  <ArrowRight size={15} />
                </button>
              ))}
            </div>
          ) : (
            <div className="upcoming-empty">
              <CalendarDays size={20} />
              <p>No upcoming deadlines.</p>
            </div>
          )}
        </aside>
      </div>
      <Modal
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title="Deadline details"
      >
        {selected && (
          <div className="workflow-detail">
            <div className="detail-title-row">
              <div>
                <div className="eyebrow">Due date</div>
                <h2>{selected.title}</h2>
              </div>
              <Badge
                tone={
                  selected.status === "completed"
                    ? "green"
                    : selected.status === "in-progress"
                      ? "gold"
                      : "neutral"
                }
              >
                {selected.status.replace("-", " ")}
              </Badge>
            </div>
            <div className="calendar-detail-date">
              <CalendarDays size={18} />
              <strong>{fmtDate(selected.dueAt)}</strong>
              <Clock3 size={16} />
              <span>{fmtTime(selected.dueAt)}</span>
            </div>
            <div className="detail-grid">
              <div>
                <span>Department</span>
                <strong>
                  {
                    DEPARTMENTS.find(
                      (department) => department.id === selected.department,
                    )?.name
                  }
                </strong>
              </div>
              <div>
                <span>Group</span>
                <strong>{selected.subTeam}</strong>
              </div>
              <div>
                <span>Ministry</span>
                <strong>{selected.ministry || "Cell 0"}</strong>
              </div>
              <div>
                <span>Service</span>
                <strong>{taskService(selected)}</strong>
              </div>
            </div>
            <div className="detail-copy">
              <span>Instructions</span>
              <p>{selected.instructions}</p>
            </div>
            <div className="calendar-progress">
              <span>Progress</span>
              <div className="progress-track">
                <span style={{ width: selected.progress + "%" }} />
              </div>
              <strong>{selected.progress}%</strong>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
