import { useMemo, useState } from "react";
import { Download, FileBarChart2, LockKeyhole, TrendingUp } from "lucide-react";
import { Badge } from "@moc/ui";
import { useWorkspace } from "@moc/client";
import type { Task } from "@moc/shared";
import "./workflows.css";

const monthKey = (date: Date) =>
  date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0");
const shiftMonth = (date: Date, amount: number) =>
  new Date(date.getFullYear(), date.getMonth() + amount, 1);
const escapeCsv = (value: unknown) => {
  const raw = String(value ?? "");
  const safe = /^[\s]*[=+\-@]/.test(raw) ? "'" + raw : raw;
  return '"' + safe.replaceAll('"', '""') + '"';
};

export default function ReportsPage() {
  const { state, user, demo, loading, error } = useWorkspace();
  const [month, setMonth] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  );
  const key = monthKey(month);
  const monthLabel = new Intl.DateTimeFormat("en-ZA", {
    month: "long",
    year: "numeric",
  }).format(month);
  const report = useMemo(() => {
    const tasks = state?.tasks ?? [];
    const requests = state?.requests ?? [];
    const completed = tasks.filter(
      (task) =>
        task.status === "completed" &&
        task.completedAt &&
        monthKey(new Date(task.completedAt)) === key,
    );
    const requested = requests.filter(
      (request) => monthKey(new Date(request.createdAt)) === key,
    );
    const overdue = tasks.filter(
      (task) =>
        task.status !== "completed" &&
        monthKey(new Date(task.dueAt)) === key &&
        new Date(task.dueAt).getTime() < Date.now(),
    );
    const durations = completed.map((task) =>
      Math.max(
        0,
        new Date(task.completedAt!).getTime() -
          new Date(task.createdAt).getTime(),
      ),
    );
    const average = durations.length
      ? durations.reduce((total, duration) => total + duration, 0) /
        durations.length
      : null;
    return { tasks, requests, completed, requested, overdue, average };
  }, [state, key]);
  const monthTasks = useMemo(
    () =>
      report.tasks.filter(
        (task) =>
          monthKey(new Date(task.createdAt)) === key ||
          (task.completedAt && monthKey(new Date(task.completedAt)) === key) ||
          monthKey(new Date(task.dueAt)) === key,
      ),
    [report.tasks, key],
  );
  const exportCsv = () => {
    const lines = [
      ["Report", "Month", monthLabel],
      ["Metric", "Value"],
      ["Requests received", report.requested.length],
      ["Tasks completed", report.completed.length],
      ["Overdue open tasks", report.overdue.length],
      [
        "Average completion time (days)",
        report.average === null
          ? "N/A"
          : (report.average / 86400000).toFixed(1),
      ],
      [],
      [
        "Task title",
        "Ministry",
        "Department",
        "Group",
        "Status",
        "Priority",
        "Progress",
        "Created at",
        "Due at",
        "Completed at",
      ],
      ...monthTasks.map((task: Task) => [
        task.title,
        task.ministry,
        task.department,
        task.subTeam,
        task.status,
        task.priority,
        task.progress + "%",
        task.createdAt,
        task.dueAt,
        task.completedAt ?? "",
      ]),
    ];
    const csv = lines.map((row) => row.map(escapeCsv).join(",")).join("\r\n");
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "moc-report-" + key + ".csv";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (loading)
    return (
      <div className="workspace-page">
        <div className="workflow-skeleton" />
      </div>
    );
  if (!user?.approved || user.department !== "cell-0")
    return (
      <div className="workspace-page">
        <section className="workflow-empty">
          <LockKeyhole />
          <h2>Reports are private to Cell 0</h2>
          <p>
            Monthly operations reporting is available to approved Cell 0 users.
          </p>
        </section>
      </div>
    );

  return (
    <div className="workspace-page workflow-page">
      <div className="page-header workflow-header">
        <div>
          <div className="eyebrow">Workspace / Insights</div>
          <div className="page-heading">
            <div>
              <h1>Reports</h1>
              <p>
                Monthly request and delivery performance across the workspace.
              </p>
            </div>
            <Badge tone={demo ? "gold" : "green"}>
              {demo ? "Demo workspace" : "Live workspace"}
            </Badge>
          </div>
        </div>
        <button
          className="button button-secondary button-md report-export"
          onClick={exportCsv}
        >
          <Download size={16} /> Export CSV
        </button>
      </div>
      <div className="report-period-bar">
        <div>
          <FileBarChart2 size={18} />
          <span>Monthly report</span>
        </div>
        <div className="report-month-controls">
          <button
            aria-label="Previous month"
            onClick={() => setMonth((value) => shiftMonth(value, -1))}
          >
            ‹
          </button>
          <strong>{monthLabel}</strong>
          <button
            aria-label="Next month"
            onClick={() => setMonth((value) => shiftMonth(value, 1))}
          >
            ›
          </button>
        </div>
      </div>
      {error && (
        <div className="workflow-alert" role="alert">
          {error}
        </div>
      )}
      <section className="report-metrics" aria-label="Monthly report metrics">
        <article className="report-metric">
          <div className="report-metric-icon gold">
            <FileBarChart2 size={18} />
          </div>
          <span>Requests received</span>
          <strong>{report.requested.length}</strong>
          <small>Submitted in {monthLabel}</small>
        </article>
        <article className="report-metric">
          <div className="report-metric-icon green">
            <TrendingUp size={18} />
          </div>
          <span>Tasks completed</span>
          <strong>{report.completed.length}</strong>
          <small>Completed in {monthLabel}</small>
        </article>
        <article className="report-metric">
          <div className="report-metric-icon rose">
            <span>!</span>
          </div>
          <span>Overdue open tasks</span>
          <strong>{report.overdue.length}</strong>
          <small>Due this month and still open</small>
        </article>
        <article className="report-metric">
          <div className="report-metric-icon sage">
            <span>◷</span>
          </div>
          <span>Average completion time</span>
          <strong>
            {report.average === null
              ? "—"
              : (report.average / 86400000).toFixed(1) + "d"}
          </strong>
          <small>
            {report.completed.length
              ? "From creation to completion"
              : "No completed tasks this month"}
          </small>
        </article>
      </section>
      <section className="report-detail-card">
        <div className="report-detail-heading">
          <div>
            <h2>Delivery activity</h2>
            <p>
              Tasks connected to the selected month by creation, due date or
              completion.
            </p>
          </div>
          <Badge>{monthTasks.length} tasks</Badge>
        </div>
        <div className="report-table-wrap">
          <table className="report-table">
            <thead>
              <tr>
                <th>Task</th>
                <th>Team</th>
                <th>Status</th>
                <th>Priority</th>
                <th>Progress</th>
                <th>Due date</th>
              </tr>
            </thead>
            <tbody>
              {monthTasks
                .slice()
                .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt))
                .map((task) => (
                  <tr key={task.id}>
                    <td>
                      <strong>{task.title}</strong>
                      <small>{task.ministry || "Cell 0"}</small>
                    </td>
                    <td>{task.subTeam}</td>
                    <td>
                      <Badge
                        tone={
                          task.status === "completed"
                            ? "green"
                            : task.status === "pending"
                              ? "gold"
                              : "neutral"
                        }
                      >
                        {task.status.replace("-", " ")}
                      </Badge>
                    </td>
                    <td>{task.priority}</td>
                    <td>
                      <div className="table-progress">
                        <span className="progress-track">
                          <span style={{ width: task.progress + "%" }} />
                        </span>
                        <small>{task.progress}%</small>
                      </div>
                    </td>
                    <td>
                      {new Intl.DateTimeFormat("en-ZA", {
                        day: "numeric",
                        month: "short",
                      }).format(new Date(task.dueAt))}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          {monthTasks.length === 0 && (
            <div className="report-table-empty">
              No task activity for this month.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
