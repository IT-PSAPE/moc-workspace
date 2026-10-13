import { useMemo, useState } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import {
  ArrowRight,
  CheckCircle2,
  Filter,
  Search,
  Settings,
  SlidersHorizontal,
} from "lucide-react";
import {
  DEPARTMENTS,
  type Progress,
  type Task,
  type TaskStatus,
} from "@moc/shared";
import { useWorkspace } from "@moc/client";
import { Badge, Button } from "@moc/ui";
import "./workflows.css";

const labels: Record<string, string> = {
  pending: "Not started",
  "in-progress": "In progress",
  completed: "Completed",
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};
const statusTone = (status: TaskStatus) =>
  status === "completed"
    ? "green"
    : status === "in-progress"
      ? "gold"
      : "neutral";
function date(value: string) {
  return new Intl.DateTimeFormat("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

export default function Departments() {
  const { state, user, act } = useWorkspace();
  const location = useLocation();
  const routeId = location.pathname.split("/").filter(Boolean)[1];
  const params = new URLSearchParams(window.location.search);
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [filter, setFilter] = useState("all");
  const [actionError, setActionError] = useState("");
  const [savingTask, setSavingTask] = useState<string | null>(null);
  const canEdit = (task: Task) =>
    user?.department === "cell-0" || task.department === user?.department;
  const allDepartments = DEPARTMENTS.filter(
    (department) => user?.department === "cell-0" || department.id !== "cell-0",
  );
  const selected = allDepartments.find(
    (department) => department.id === routeId,
  );
  const allTasks = state?.tasks ?? [];
  const visibleTasks = useMemo(
    () =>
      allTasks.filter(
        (task) =>
          (!selected || task.department === selected.id) &&
          (!query.trim() ||
            `${task.title} ${task.ministry} ${task.service} ${task.subTeam}`
              .toLowerCase()
              .includes(query.toLowerCase())) &&
          (filter === "all" || task.status === filter),
      ),
    [allTasks, selected, query, filter],
  );
  const currentDepartments = selected ? [selected] : allDepartments;
  const pendingCount = visibleTasks.filter(
    (task) => task.status === "pending",
  ).length;
  const activeCount = visibleTasks.filter(
    (task) => task.status === "in-progress",
  ).length;
  const completeCount = visibleTasks.filter(
    (task) => task.status === "completed",
  ).length;

  async function updateProgress(task: Task) {
    if (!canEdit(task) || savingTask) return;
    setSavingTask(task.id);
    setActionError("");
    const nextProgress = (
      task.progress >= 75 ? 100 : task.progress + 25
    ) as Progress;
    try {
      await act({
        type: "update-task",
        taskId: task.id,
        progress: nextProgress,
        status:
          nextProgress === 100
            ? "completed"
            : nextProgress === 0
              ? "pending"
              : "in-progress",
      });
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Could not update progress.",
      );
    } finally {
      setSavingTask(null);
    }
  }

  return (
    <div className="departments-page">
      {actionError && (
        <div role="alert" className="connection-error">
          {actionError}
          <button
            className="button button-ghost"
            onClick={() => setActionError("")}
          >
            Dismiss
          </button>
        </div>
      )}
      <div className="page-heading">
        <div>
          <h1>{selected ? selected.name : "Departments"}</h1>
        </div>
        {user?.department === "cell-0" && (
          <Button
            variant="secondary"
            onClick={() => {
              window.location.href = "/settings";
            }}
          >
            <Settings size={16} /> Team access
          </Button>
        )}
      </div>
      {!selected && (
        <div className="department-overview-grid">
          {currentDepartments.map((department) => {
            const tasks = allTasks.filter(
              (task) => task.department === department.id,
            );
            const complete = tasks.filter(
              (task) => task.status === "completed",
            ).length;
            const active = tasks.filter(
              (task) => task.status !== "completed",
            ).length;
            const progress = tasks.length
              ? Math.round(
                  tasks.reduce((sum, task) => sum + task.progress, 0) /
                    tasks.length,
                )
              : 0;
            return (
              <a
                className={`overview-card overview-${department.id}`}
                key={department.id}
                href={`/departments/${department.id}`}
              >
                <div className="overview-card-top">
                  <span className="overview-mark">
                    {department.name === "Visual Media"
                      ? "VM"
                      : department.name.slice(0, 2).toUpperCase()}
                  </span>
                  <ArrowRight size={17} />
                </div>
                <h2>{department.name}</h2>
                {department.groups.some(
                  (group) => group !== department.name,
                ) && <p>{department.groups.join(" · ")}</p>}
                <div className="overview-metrics">
                  <span>
                    <strong>{active}</strong> active
                  </span>
                  <span>
                    <strong>{complete}</strong> completed
                  </span>
                </div>
                <div className="overview-progress">
                  <div className="progress-track">
                    <i style={{ width: `${progress}%` }} />
                  </div>
                  <span>{progress}% overall progress</span>
                </div>
              </a>
            );
          })}
        </div>
      )}
      <section className="task-board">
        <div className="task-board-head">
          <div>
            <h2>{selected ? "Team tasks" : "Task overview"}</h2>
          </div>
          <div className="task-filters">
            <label className="table-search">
              <Search size={16} />
              <input
                aria-label="Search tasks"
                placeholder="Search by title or ministry"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <label className="filter-select">
              <SlidersHorizontal size={15} />
              <select
                aria-label="Filter tasks by status"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              >
                <option value="all">All statuses</option>
                <option value="pending">Not started</option>
                <option value="in-progress">In progress</option>
                <option value="completed">Completed</option>
              </select>
            </label>
          </div>
        </div>
        <div className="task-summary">
          <span>
            <i className="summary-dot dot-pending" />
            {pendingCount} not started
          </span>
          <span>
            <i className="summary-dot dot-active" />
            {activeCount} in progress
          </span>
          <span>
            <i className="summary-dot dot-done" />
            {completeCount} completed
          </span>
        </div>
        {visibleTasks.length ? (
          <div className="task-table-wrap">
            <table className="task-table">
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Department</th>
                  <th>Due date</th>
                  <th>Priority</th>
                  <th>Status</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleTasks
                  .slice()
                  .sort((a, b) => a.dueAt.localeCompare(b.dueAt))
                  .map((task) => (
                    <tr key={task.id}>
                      <td>
                        <div className="task-title-cell">
                          <strong>{task.title}</strong>
                          <span>
                            {task.ministry} <i>·</i> {task.subTeam}
                          </span>
                          <div className="table-progress">
                            <div className="progress-track">
                              <i style={{ width: `${task.progress}%` }} />
                            </div>
                            <small>{task.progress}%</small>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className="team-chip">
                          <i className={`team-dot team-${task.department}`} />
                          {
                            DEPARTMENTS.find(
                              (department) => department.id === task.department,
                            )?.name
                          }
                        </span>
                      </td>
                      <td className="due-date-cell">{date(task.dueAt)}</td>
                      <td>
                        <Badge
                          tone={
                            task.priority === "urgent" ||
                            task.priority === "high"
                              ? "gold"
                              : "neutral"
                          }
                        >
                          {labels[task.priority]}
                        </Badge>
                      </td>
                      <td>
                        <Badge tone={statusTone(task.status)}>
                          {labels[task.status]}
                        </Badge>
                      </td>
                      <td>
                        <button
                          className="advance-task"
                          type="button"
                          onClick={() => updateProgress(task)}
                          disabled={
                            task.status === "completed" ||
                            !canEdit(task) ||
                            !!savingTask
                          }
                          aria-label={
                            !canEdit(task)
                              ? `${task.title} is view only`
                              : task.status === "completed"
                                ? `${task.title} completed`
                                : `Advance ${task.title} progress`
                          }
                        >
                          {task.status === "completed" ? (
                            <CheckCircle2 size={17} />
                          ) : (
                            <ArrowRight size={17} />
                          )}
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="task-empty">
            <div className="empty-icon">
              <Filter size={21} />
            </div>
            <h3>
              {query || filter !== "all"
                ? "No tasks match these filters"
                : "No tasks here yet"}
            </h3>
            <p>
              {query || filter !== "all"
                ? "Try another search or status filter."
                : "Tasks routed to this team will appear here."}
            </p>
            {(query || filter !== "all") && (
              <Button
                variant="ghost"
                onClick={() => {
                  setQuery("");
                  setFilter("all");
                }}
              >
                Clear filters
              </Button>
            )}
          </div>
        )}
      </section>
      {selected && (
        <Link className="back-link" to="/departments">
          ← Back to all departments
        </Link>
      )}
    </div>
  );
}
