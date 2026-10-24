import { useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  FileBarChart2,
  LockKeyhole,
  TrendingUp,
  XCircle,
} from "lucide-react";
import { DataTable, type DataTableColumnDef } from "@moc/ui";
import { api, neonAuth, useWorkspace } from "@moc/client";
import {
  createMonthlyReport,
  reportingMonthKey,
  REPORTING_TIME_ZONE,
  shiftReportingMonth,
  type MonthlyReport,
  type ReportRecord,
} from "@moc/shared";
import DetailsDrawer from "../components/DetailsDrawer";
import {
  createWorkColumns,
  WORK_TABLE_MIN_WIDTH,
  type WorkTableRow,
} from "../components/WorkTable";
import RequestDetails from "../RequestDetails";
import TaskDetails from "../TaskDetails";
import "./workflows.css";

const timeZone = REPORTING_TIME_ZONE;
const dateFormatter = new Intl.DateTimeFormat("en-ZA", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone,
});
const monthFormatter = new Intl.DateTimeFormat("en-ZA", {
  month: "long",
  year: "numeric",
  timeZone,
});
const milestones = [
  { key: "receivedAt", label: "Received date" },
  { key: "approvedAt", label: "Approved date" },
  { key: "rejectedAt", label: "Rejected date" },
  { key: "inProgressAt", label: "In progress date" },
  { key: "completedAt", label: "Completed date" },
] as const;
const statuses: Record<ReportRecord["status"], string> = {
  backlog: "Backlog",
  approved: "Approved",
  rejected: "Rejected",
  pending: "Pending",
  "in-progress": "In progress",
  completed: "Completed",
};
const escapeCsv = (value: unknown) => {
  const raw = String(value ?? "");
  const safe = /^[\s]*[=+\-@]/.test(raw) ? "'" + raw : raw;
  return '"' + safe.replaceAll('"', '""') + '"';
};
const duration = (milliseconds: number | null) => {
  if (milliseconds === null) return "—";
  const hours = milliseconds / 3_600_000;
  if (hours < 1) return `${Math.round(milliseconds / 60_000)} min`;
  if (hours < 24) return `${hours.toFixed(1)} hr`;
  return `${(hours / 24).toFixed(1)} days`;
};
const sampleLabel = (count: number) =>
  `${count} ${count === 1 ? "record" : "records"} with both dates`;

type ReportTableRow = WorkTableRow & { record: ReportRecord };
const columns: DataTableColumnDef<ReportTableRow>[] = [
  ...createWorkColumns<ReportTableRow>(),
  ...milestones.map(
    ({ key, label }): DataTableColumnDef<ReportTableRow> => ({
      id: key,
      header: label,
      accessorFn: (row) => row.record.lifecycle[key],
      meta: {
        label,
        headerClassName: "w-[190px]",
        className: "whitespace-nowrap tabular-nums",
      },
      cell: ({ row }) => {
        const value = row.original.record.lifecycle[key];
        return value && Number.isFinite(Date.parse(value)) ? (
          <time dateTime={value}>{dateFormatter.format(new Date(value))}</time>
        ) : null;
      },
    }),
  ),
];

function Decisions({ report }: { report: MonthlyReport }) {
  const { approved, rejected } = report.metrics;
  const total = approved + rejected;
  return (
    <section
      className="flex min-w-0 flex-col gap-5 rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-5"
      aria-labelledby="report-decisions-heading"
    >
      <div>
        <h2
          id="report-decisions-heading"
          className="m-0 text-base font-semibold text-[var(--ink)]"
        >
          Decisions
        </h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Approval and rejection dates in the selected month.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <span className="flex items-center gap-2 text-sm text-[var(--ink-secondary)]">
            <CheckCircle2
              size={15}
              className="text-[var(--success-text)]"
              aria-hidden="true"
            />
            Approved
          </span>
          <strong className="mt-2 block text-3xl font-semibold tabular-nums text-[var(--ink)]">
            {approved}
          </strong>
        </div>
        <div>
          <span className="flex items-center gap-2 text-sm text-[var(--ink-secondary)]">
            <XCircle
              size={15}
              className="text-[var(--danger-text)]"
              aria-hidden="true"
            />
            Rejected
          </span>
          <strong className="mt-2 block text-3xl font-semibold tabular-nums text-[var(--ink)]">
            {rejected}
          </strong>
        </div>
      </div>
      <div
        className="flex h-3 overflow-hidden rounded-sm bg-[var(--neutral-100)]"
        role="img"
        aria-label={
          total
            ? `${approved} approvals and ${rejected} rejections`
            : "No decisions recorded this month"
        }
      >
        {total > 0 && (
          <>
            <span
              className="bg-[var(--success-text)]"
              style={{ width: `${(approved / total) * 100}%` }}
            />
            <span
              className="bg-[var(--danger-text)]"
              style={{ width: `${(rejected / total) * 100}%` }}
            />
          </>
        )}
      </div>
      <p className="m-0 text-xs leading-5 text-[var(--muted)]">
        {total
          ? "A reconsidered request can have both an approval and a rejection date."
          : "Decisions will appear here when a request is approved or rejected."}
      </p>
    </section>
  );
}

function StageDurations({ report }: { report: MonthlyReport }) {
  const stages = [
    {
      from: "Received",
      to: "Approved",
      value: report.metrics.averageApprovalMs,
      samples: report.metrics.approvalSamples,
    },
    {
      from: "Approved",
      to: "In progress",
      value: report.metrics.averageStartMs,
      samples: report.metrics.startSamples,
    },
    {
      from: "In progress",
      to: "Completed",
      value: report.metrics.averageCompletionMs,
      samples: report.metrics.completionSamples,
    },
  ];
  return (
    <section
      className="min-w-0 rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-5"
      aria-labelledby="report-stages-heading"
    >
      <h2
        id="report-stages-heading"
        className="m-0 text-base font-semibold text-[var(--ink)]"
      >
        Time between stages
      </h2>
      <p className="mt-1 text-sm text-[var(--muted)]">
        Average time for each stage ending in the selected month.
      </p>
      <dl className="mt-5 grid gap-5 sm:grid-cols-3">
        {stages.map((stage) => (
          <div key={stage.to} className="min-w-0">
            <dt className="flex flex-wrap items-center gap-1.5 text-sm text-[var(--ink-secondary)]">
              <span>{stage.from}</span>
              <ArrowRight size={13} aria-hidden="true" />
              <span>{stage.to}</span>
            </dt>
            <dd className="m-0 mt-2 text-2xl font-semibold tabular-nums text-[var(--ink)]">
              {duration(stage.value)}
            </dd>
            <dd className="m-0 mt-1 text-xs leading-5 text-[var(--muted)]">
              {sampleLabel(stage.samples)}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mb-0 mt-5 text-xs leading-5 text-[var(--muted)]">
        Records with missing or out-of-order dates are excluded from averages.
      </p>
    </section>
  );
}

function WeeklyActivity({ report }: { report: MonthlyReport }) {
  const series = [
    { key: "received", label: "Received", color: "bg-[var(--brand-700)]" },
    { key: "approved", label: "Approved", color: "bg-[var(--success-text)]" },
    { key: "rejected", label: "Rejected", color: "bg-[var(--danger-text)]" },
  ] as const;
  const maximum = Math.max(
    1,
    ...report.weeklySeries.flatMap((week) =>
      series.map(({ key }) => week[key]),
    ),
  );
  return (
    <section
      className="min-w-0 rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-5"
      aria-labelledby="report-weekly-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2
            id="report-weekly-heading"
            className="m-0 text-base font-semibold text-[var(--ink)]"
          >
            Weekly request activity
          </h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Compare requests received with decisions recorded each week.
          </p>
        </div>
        <ul
          className="m-0 flex list-none flex-wrap gap-4 p-0 text-xs text-[var(--ink-secondary)]"
          aria-label="Activity legend"
        >
          {series.map((item) => (
            <li key={item.key} className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className={`size-2 rounded-full ${item.color}`}
              />
              {item.label}
            </li>
          ))}
        </ul>
      </div>
      <div className="mt-5 space-y-4">
        {report.weeklySeries.map((week) => (
          <div
            key={week.startAt}
            className="grid grid-cols-[5rem_minmax(0,1fr)] gap-3 sm:grid-cols-[6rem_minmax(0,1fr)]"
          >
            <span className="pt-0.5 text-xs text-[var(--muted)]">
              {week.label}
            </span>
            <div className="space-y-1.5">
              {series.map(({ key, label, color }) => (
                <div
                  key={key}
                  className="flex items-center gap-2"
                  role="img"
                  aria-label={`${week.label}, ${label.toLowerCase()}: ${week[key]}`}
                >
                  <div
                    className="h-2 flex-1 rounded-sm bg-[var(--neutral-50)]"
                    aria-hidden="true"
                  >
                    <div
                      className={`h-full rounded-sm ${color}`}
                      style={{ width: `${(week[key] / maximum) * 100}%` }}
                    />
                  </div>
                  <span
                    className="w-7 text-right text-xs tabular-nums text-[var(--ink-secondary)]"
                    aria-hidden="true"
                  >
                    {week[key]}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function ReportsPage() {
  const { state, user, loading } = useWorkspace();
  const [month, setMonth] = useState(() => reportingMonthKey(new Date()));
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const monthLabel = monthFormatter.format(
    new Date(`${month}-15T12:00:00+02:00`),
  );
  const report = useMemo(
    () => (state ? createMonthlyReport(state, month) : null),
    [state, month],
  );
  const reportRows = useMemo<ReportTableRow[]>(
    () =>
      (report?.records ?? [])
        .map((record): ReportTableRow => {
          const department = state?.catalog.departments.find(
            (item) => item.id === record.department,
          );
          return {
            id: record.id,
            title: record.title,
            ministry: record.ministry || "Cell 0",
            serviceName:
              state?.catalog.services.find((item) => item.id === record.service)
                ?.name ??
              (record.service || "—"),
            dueAt: record.dueAt,
            groupName: record.subTeam || "Unassigned",
            departmentName:
              department?.name ?? (record.department || "Unassigned"),
            departmentColor: department?.color,
            statusLabel: statuses[record.status],
            statusTone:
              record.status === "completed" || record.status === "approved"
                ? "green"
                : record.status === "rejected"
                  ? "red"
                  : record.status === "in-progress"
                    ? "gold"
                    : "neutral",
            onOpen: () => setSelectedId(record.id),
            record,
          };
        })
        .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt)),
    [report, state],
  );
  const selected = report?.records.find((record) => record.id === selectedId);
  const selectedTask = state?.tasks.find(
    (task) => task.id === selected?.taskId,
  );
  const selectedRequest = state?.requests.find(
    (request) => request.id === selected?.requestId,
  );

  const exportCsv = async () => {
    if (!report) return;
    const { metrics } = report;
    const lines = [
      ["Report", "Month", monthLabel],
      ["Time zone", timeZone],
      [
        "Scope",
        "Milestones dated within the selected month; detail rows include any milestone or due date in the month.",
      ],
      ["Metric", "Value", "Records with both dates"],
      ["Requests received", metrics.received],
      ["Requests approved", metrics.approved],
      ["Requests rejected", metrics.rejected],
      ["Tasks started", metrics.inProgress],
      ["Tasks completed", metrics.completed],
      ["Overdue open tasks", metrics.overdue],
      [
        "Average received to approved (hours)",
        metrics.averageApprovalMs === null
          ? ""
          : metrics.averageApprovalMs / 3_600_000,
        metrics.approvalSamples,
      ],
      [
        "Average approved to in progress (hours)",
        metrics.averageStartMs === null
          ? ""
          : metrics.averageStartMs / 3_600_000,
        metrics.startSamples,
      ],
      [
        "Average in progress to completed (hours)",
        metrics.averageCompletionMs === null
          ? ""
          : metrics.averageCompletionMs / 3_600_000,
        metrics.completionSamples,
      ],
      [
        "Average received to completed (hours)",
        metrics.averageTotalMs === null
          ? ""
          : metrics.averageTotalMs / 3_600_000,
        metrics.totalSamples,
      ],
      [],
      [
        "Task",
        "Ministry",
        "Service",
        "Due date",
        "Group",
        "Department",
        "Status",
        ...milestones.map(({ label }) => label),
      ],
      ...reportRows.map((row) => [
        row.title,
        row.ministry,
        row.serviceName,
        row.dueAt,
        row.groupName,
        row.departmentName,
        row.statusLabel,
        ...milestones.map(({ key }) => row.record.lifecycle[key] ?? ""),
      ]),
    ];
    const csv = lines.map((row) => row.map(escapeCsv).join(",")).join("\r\n");
    if (neonAuth) {
      setExporting(true);
      setExportError("");
      try {
        const result = await api<{ url: string; filename: string }>("/api/reports/export", {
          method: "POST", body: JSON.stringify({ month, csv }),
        });
        const anchor = document.createElement("a");
        anchor.href = result.url;
        anchor.download = result.filename;
        anchor.click();
      } catch (error) {
        setExportError((error as Error).message);
      } finally { setExporting(false); }
      return;
    }
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `moc-report-${month}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (loading)
    return (
      <div className="workspace-page">
        <div className="workflow-skeleton" />
      </div>
    );
  if (!user?.approved || !user.isLeader || user.department !== "cell-0") {
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
  }
  if (!report) return null;

  return (
    <div className="workspace-page workflow-page">
      <div className="page-header workflow-header">
        <div className="page-heading">
          <h1>Reports</h1>
        </div>
        <div className="report-header-actions">
          <div className="report-month-controls" aria-label="Report month">
            <button
              type="button"
              className="inline-flex items-center justify-center"
              aria-label="Previous month"
              onClick={() =>
                setMonth((value) => shiftReportingMonth(value, -1))
              }
            >
              <ChevronLeft size={16} aria-hidden="true" />
            </button>
            <strong aria-live="polite">{monthLabel}</strong>
            <button
              type="button"
              className="inline-flex items-center justify-center"
              aria-label="Next month"
              onClick={() => setMonth((value) => shiftReportingMonth(value, 1))}
            >
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          </div>
          <button
            type="button"
            className="button button-secondary button-md report-export"
            onClick={exportCsv}
            disabled={exporting}
          >
            <Download size={16} aria-hidden="true" />
            {exporting ? "Preparing export…" : "Export CSV"}
          </button>
        </div>
      </div>
      <p className="m-0 text-sm leading-6 text-[var(--muted)]">
        Milestones recorded in {monthLabel}. Dates and month boundaries use
        Johannesburg time.
      </p>
      {exportError && <p role="alert" className="workflow-feedback">{exportError}</p>}
      <section className="report-metrics" aria-label="Monthly report metrics">
        <article className="report-metric">
          <div className="report-metric-label">
            <FileBarChart2 size={16} aria-hidden="true" />
            <span>Requests received</span>
          </div>
          <strong>{report.metrics.received}</strong>
          <small>New requests received this month</small>
        </article>
        <article className="report-metric">
          <div className="report-metric-label">
            <TrendingUp size={16} aria-hidden="true" />
            <span>Tasks completed</span>
          </div>
          <strong>{report.metrics.completed}</strong>
          <small>Completion dates in this month</small>
        </article>
        <article className="report-metric">
          <div className="report-metric-label">
            <AlertCircle size={16} aria-hidden="true" />
            <span>Overdue open tasks</span>
          </div>
          <strong>{report.metrics.overdue}</strong>
          <small>Unfinished tasks due this month and past due now</small>
        </article>
        <article className="report-metric">
          <div className="report-metric-label">
            <Clock3 size={16} aria-hidden="true" />
            <span>Avg. completion</span>
          </div>
          <strong>{duration(report.metrics.averageTotalMs)}</strong>
          <small>
            Received → completed · {sampleLabel(report.metrics.totalSamples)}
          </small>
        </article>
      </section>
      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Decisions report={report} />
        <StageDurations report={report} />
      </div>
      <WeeklyActivity report={report} />
      <div className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="m-0 text-base font-semibold text-[var(--ink)]">
            Detailed activity
          </h2>
          <p className="m-0 text-xs text-[var(--muted)]">
            Any milestone or due date in {monthLabel}. Missing dates remain
            blank.
          </p>
        </div>
        <DataTable.Root
          columns={columns}
          data={reportRows}
          getRowId={(row: ReportTableRow) => row.id}
        >
          <DataTable.Table
            className="w-full"
            style={{ minWidth: WORK_TABLE_MIN_WIDTH + milestones.length * 190 }}
            containerClassName="max-w-full overflow-x-auto"
          >
            <DataTable.Caption>
              {monthLabel} request and task activity
            </DataTable.Caption>
            <DataTable.Header />
            <DataTable.Body emptyMessage="No request or task activity for this month." />
          </DataTable.Table>
        </DataTable.Root>
      </div>
      <DetailsDrawer
        open={Boolean(selectedTask || selectedRequest)}
        onClose={() => setSelectedId(null)}
        title={selectedTask ? "Task details" : "Request details"}
      >
        {selectedTask ? (
          <TaskDetails key={selectedTask.id} task={selectedTask} />
        ) : selectedRequest ? (
          <RequestDetails key={selectedRequest.id} request={selectedRequest} />
        ) : null}
      </DetailsDrawer>
    </div>
  );
}
