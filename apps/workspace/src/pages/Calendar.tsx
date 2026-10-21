import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Search,
} from "lucide-react";
import { Button, Field, Modal } from "@moc/ui";
import { type Task } from "@moc/shared";
import { useWorkspace } from "@moc/client";
import { FilterDrawer } from "../components/UiDialogs";
import TaskDetails from "../TaskDetails";
import { layoutDeadlines } from "./schedule-layout";
import "./workflows.css";
import "./schedule.css";

type View = "month" | "week" | "day" | "agenda";
const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const dateKey = (date: Date) =>
  `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
const dateLabel = (date: Date) =>
  new Intl.DateTimeFormat("en-ZA", { dateStyle: "full" }).format(date);
const timeLabel = (value: string) =>
  new Intl.DateTimeFormat("en-ZA", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
const shortDate = (date: Date) =>
  new Intl.DateTimeFormat("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
const addDays = (date: Date, amount: number) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount);
const monday = (date: Date) => addDays(date, -((date.getDay() + 6) % 7));

export default function CalendarPage() {
  const { state, user, loading, error } = useWorkspace();
  const [date, setDate] = useState(() => new Date());
  const [now, setNow] = useState(() => new Date());
  const [view, setView] = useState<View>("month");
  const [search, setSearch] = useState("");
  const [department, setDepartment] = useState("all");
  const [status, setStatus] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewDate, setPreviewDate] = useState<Date | null>(null);
  const hours = useRef<HTMLDivElement>(null);
  const isCell0 = user?.department === "cell-0";
  const departments = state?.catalog?.departments ?? [];
  const departmentsById = useMemo(
    () => new Map(departments.map((item) => [item.id, item])),
    [departments],
  );
  const today = new Date();
  const todayKey = dateKey(now);
  const currentMinute = now.getHours() * 60 + now.getMinutes();
  const tasks = useMemo(
    () =>
      (state?.tasks ?? [])
        .filter(
          (task) =>
            (isCell0 || task.department === user?.department) &&
            (department === "all" || task.department === department) &&
            (status === "all" || task.status === status) &&
            `${task.title} ${task.ministry} ${task.subTeam}`
              .toLowerCase()
              .includes(search.trim().toLowerCase()),
        )
        .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt)),
    [state?.tasks, isCell0, user?.department, department, status, search],
  );
  const selected = (state?.tasks ?? []).find((task) => task.id === selectedId);
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const last = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  const gridStart = monday(first);
  const dayCount =
    Math.ceil((((first.getDay() + 6) % 7) + last.getDate()) / 7) * 7;
  const days = Array.from({ length: dayCount }, (_, index) =>
    addDays(gridStart, index),
  );
  const rangeDays = Array.from(
    { length: view === "week" ? 7 : 1 },
    (_, index) => addDays(view === "week" ? monday(date) : date, index),
  );
  const selectedRangeIncludesToday = rangeDays.some(
    (day) => dateKey(day) === todayKey,
  );
  const tasksOn = (day: Date) =>
    tasks.filter((task) => dateKey(new Date(task.dueAt)) === dateKey(day));
  const agendaTasks = tasks.filter(
    (task) =>
      task.status !== "completed" ||
      Date.parse(task.dueAt) >=
        new Date(
          today.getFullYear(),
          today.getMonth(),
          today.getDate(),
        ).getTime(),
  );
  const agendaDays = [
    ...new Map(
      agendaTasks.map((task) => {
        const due = new Date(task.dueAt);
        return [dateKey(due), due];
      }),
    ).values(),
  ];
  const monthLabel = new Intl.DateTimeFormat("en-ZA", {
    month: "long",
    year: "numeric",
  }).format(date);
  const title =
    view === "day"
      ? dateLabel(date)
      : view === "agenda"
        ? "Agenda"
        : monthLabel;
  const range =
    view === "month"
      ? `${shortDate(first)} – ${shortDate(last)}`
      : view === "week"
        ? `${shortDate(rangeDays[0])} – ${shortDate(rangeDays[6])}`
        : null;
  useEffect(() => {
    if (hours.current) {
      hours.current.scrollTop = selectedRangeIncludesToday
        ? Math.max(0, ((currentMinute - 60) * 128) / 60)
        : 8 * 128;
    }
  }, [view, date]);
  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  function changePeriod(direction: number) {
    if (view !== "month")
      return setDate(addDays(date, direction * (view === "week" ? 7 : 1)));
    const end = new Date(
      date.getFullYear(),
      date.getMonth() + direction + 1,
      0,
    ).getDate();
    setDate(
      new Date(
        date.getFullYear(),
        date.getMonth() + direction,
        Math.min(date.getDate(), end),
      ),
    );
  }
  function openTask(task: Task) {
    setPreviewDate(null);
    setSelectedId(task.id);
  }
  function renderTask(task: Task, row = false) {
    return (
      <button
        key={task.id}
        className={`calendar-task schedule-event ${row ? "schedule-event-row" : ""}`}
        data-dept={task.department}
        data-dept-color={departmentsById.get(task.department)?.color}
        onClick={() => openTask(task)}
        title={task.title}
        aria-label={`${task.title}, ${timeLabel(task.dueAt)}`}
      >
        <span className="schedule-event-copy">
          <strong>{task.title}</strong>
          {row && (
            <small>
              {departmentsById.get(task.department)?.name ?? task.department} ·{" "}
              {task.ministry} · {task.status.replace("-", " ")}
            </small>
          )}
        </span>
        <time dateTime={task.dueAt}>{timeLabel(task.dueAt)}</time>
      </button>
    );
  }
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
          <h2>Calendar access required</h2>
          <p>Sign in with an approved leader account to view deadlines.</p>
        </section>
      </div>
    );

  return (
    <div className="workspace-page workflow-page schedule-page">
      <header className="schedule-heading">
        <h1>Work</h1>
        <label className="schedule-search">
          <Search size={16} />
          <input
            aria-label="Search work"
            placeholder="Search work…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      </header>
      {error && (
        <div className="workflow-alert" role="alert">
          {error}
        </div>
      )}
      <section
        className="calendar-layout schedule-calendar"
        aria-label="Task deadline calendar"
      >
        <header className="schedule-toolbar">
          <div className="schedule-period">
            <div aria-live="polite" aria-atomic="true">
              <h2>{title}</h2>
              {range && <p>{range}</p>}
            </div>
          </div>
          <div className="schedule-controls">
            {view !== "agenda" && (
              <div
                className="schedule-navigation"
                role="group"
                aria-label="Calendar navigation"
              >
                <Button
                  aria-label={`Previous ${view}`}
                  onClick={() => changePeriod(-1)}
                >
                  <ChevronLeft size={16} />
                </Button>
                <Button onClick={() => setDate(new Date())}>Today</Button>
                <Button
                  aria-label={`Next ${view}`}
                  onClick={() => changePeriod(1)}
                >
                  <ChevronRight size={16} />
                </Button>
              </div>
            )}
            <select
              aria-label="Calendar view"
              value={view}
              onChange={(event) => setView(event.target.value as View)}
            >
              {["day", "week", "month", "agenda"].map((value) => (
                <option key={value} value={value}>
                  {value[0].toUpperCase() + value.slice(1)} view
                </option>
              ))}
            </select>
            <FilterDrawer
              activeCount={Number(department !== "all") + Number(status !== "all")}
              onReset={() => {
                setDepartment("all");
                setStatus("all");
              }}
            >
              <Field label="Department">
                <select
                  aria-label="Filter work by department"
                  value={department}
                  onChange={(event) => setDepartment(event.target.value)}
                >
                  <option value="all">All departments</option>
                  {departments
                    .filter((item) => isCell0 || item.id === user?.department)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="Status">
                <select
                  aria-label="Filter work by status"
                  value={status}
                  onChange={(event) => setStatus(event.target.value)}
                >
                  <option value="all">All statuses</option>
                  <option value="pending">Pending</option>
                  <option value="in-progress">In progress</option>
                  <option value="completed">Completed</option>
                </select>
              </Field>
            </FilterDrawer>
          </div>
        </header>
        {view === "month" && (
          <div
            className="schedule-month"
            role="group"
            aria-label="Month calendar"
          >
            <div className="schedule-weekdays">
              {weekdays.map((day) => (
                <div key={day}>{day}</div>
              ))}
            </div>
            <div className="schedule-month-days">
              {days.map((day) => {
                const items = tasksOn(day);
                return (
                  <div
                    className={`schedule-day ${day.getMonth() !== date.getMonth() ? "is-outside" : ""}`}
                    key={dateKey(day)}
                  >
                    <button
                      className={`schedule-day-number ${dateKey(day) === dateKey(today) ? "is-today" : ""}`}
                      aria-haspopup="dialog"
                      aria-label={`${dateLabel(day)}, ${items.length} items`}
                      onClick={() => {
                        setDate(day);
                        setPreviewDate(day);
                      }}
                    >
                      {day.getDate()}
                    </button>
                    <div className="schedule-day-events">
                      {items.slice(0, 3).map((task) => renderTask(task))}
                      {items.length > 3 && (
                        <button
                          className="schedule-more"
                          onClick={() => setPreviewDate(day)}
                        >
                          Show all {items.length} items
                        </button>
                      )}
                    </div>
                    <span className="schedule-day-dots" aria-hidden="true">
                      {items.slice(0, 3).map((task) => (
                        <i key={task.id} />
                      ))}
                      {items.length > 3 && <small>+{items.length - 3}</small>}
                    </span>
                  </div>
                );
              })}
            </div>
            {!tasks.some(
              (task) =>
                new Date(task.dueAt).getMonth() === date.getMonth() &&
                new Date(task.dueAt).getFullYear() === date.getFullYear(),
            ) && (
              <p className="schedule-empty">
                No deadlines this month{search ? " match your search" : ""}.
              </p>
            )}
          </div>
        )}
        {(view === "week" || view === "day") && (
          <div
            className="schedule-range"
            ref={hours}
            tabIndex={0}
            aria-label="Calendar hours, scroll to explore the day"
          >
            <div
              className="schedule-range-content"
              style={
                {
                  minWidth: view === "week" ? 700 : undefined,
                  "--schedule-columns": rangeDays.length,
                } as React.CSSProperties
              }
            >
              <div className="schedule-range-heading">
                <span />
                {rangeDays.map((day) => (
                  <div key={dateKey(day)}>
                    <span>{weekdays[(day.getDay() + 6) % 7]}</span>
                    <strong
                      className={
                        dateKey(day) === dateKey(today) ? "is-today" : ""
                      }
                    >
                      {day.getDate()}
                    </strong>
                  </div>
                ))}
              </div>
              <div className="schedule-hour-grid">
                <div className="schedule-hour-labels">
                  {Array.from({ length: 24 }, (_, hour) => (
                    <span key={hour}>
                      {hour % 12 || 12}
                      {hour < 12 ? "am" : "pm"}
                    </span>
                  ))}
                </div>
                {rangeDays.map((day) => (
                  <div
                    className="schedule-hour-day"
                    key={dateKey(day)}
                    aria-label={dateLabel(day)}
                  >
                    {dateKey(day) === todayKey && (
                      <div
                        className="schedule-current-time"
                        role="img"
                        aria-label={`Current time today, ${timeLabel(now.toISOString())}`}
                        style={{ top: (currentMinute * 128) / 60 }}
                      >
                        <span aria-hidden="true" />
                      </div>
                    )}
                    {layoutDeadlines(tasksOn(day)).map(
                      ({ task, minute, column, columns }) => {
                        return (
                          <div
                            key={task.id}
                            className="schedule-timed-event"
                            style={{
                              top: (minute * 128) / 60,
                              left: `calc(${(column * 100) / columns}% + 3px)`,
                              width: `calc(${100 / columns}% - 6px)`,
                            }}
                          >
                            {renderTask(task)}
                          </div>
                        );
                      },
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
        {view === "agenda" && (
          <div className="schedule-agenda">
            {agendaDays.length ? (
              agendaDays.map((day) => (
                <section className="schedule-agenda-day" key={dateKey(day)}>
                  <h3>{dateLabel(day)}</h3>
                  <div>
                    {tasksOn(day)
                      .filter((task) => agendaTasks.includes(task))
                      .map((task) => renderTask(task, true))}
                  </div>
                </section>
              ))
            ) : (
              <p className="schedule-empty">No work matches these filters.</p>
            )}
          </div>
        )}
      </section>
      <Modal
        open={Boolean(previewDate)}
        onClose={() => setPreviewDate(null)}
        title={previewDate ? dateLabel(previewDate) : "Day details"}
        className="schedule-day-preview"
      >
        <div className="schedule-preview-list">
          {previewDate &&
            (tasksOn(previewDate).length ? (
              tasksOn(previewDate).map((task) => renderTask(task, true))
            ) : (
              <p className="schedule-empty">No items scheduled for this day.</p>
            ))}
        </div>
      </Modal>
      <Modal
        open={Boolean(selected)}
        onClose={() => setSelectedId(null)}
        title="Deadline details"
        className="task-detail-modal"
      >
        {selected && <TaskDetails key={selected.id} task={selected} />}
      </Modal>
    </div>
  );
}
