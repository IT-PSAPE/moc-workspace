import type {
  ApprovalStatus,
  LifecycleTimestamps,
  MinistryRequest,
  Task,
  TaskStatus,
  WorkspaceState,
} from "./types";

export const REPORTING_TIME_ZONE = "Africa/Johannesburg";
const DAY_MS = 86_400_000;
// Johannesburg uses UTC+02:00 year-round. Never use the host's local timezone.
const REPORTING_OFFSET_MS = 2 * 60 * 60 * 1_000;
const milestones = [
  "receivedAt", "approvedAt", "rejectedAt", "inProgressAt", "completedAt",
] as const;
export type ReportLifecycleTimestamps = LifecycleTimestamps;

export interface ReportRecord {
  id: string;
  kind: "request" | "task";
  requestId?: string;
  taskId?: string;
  reference?: string;
  title: string;
  ministry: string;
  service: string;
  department: string;
  subTeam: string;
  dueAt: string;
  status: ApprovalStatus | TaskStatus;
  lifecycle: ReportLifecycleTimestamps;
}

export interface ReportMetrics {
  received: number;
  approved: number;
  rejected: number;
  inProgress: number;
  completed: number;
  overdue: number;
  averageApprovalMs: number | null;
  averageStartMs: number | null;
  averageCompletionMs: number | null;
  averageTotalMs: number | null;
  approvalSamples: number;
  startSamples: number;
  completionSamples: number;
  totalSamples: number;
}

export interface ReportSeriesPoint extends Omit<ReportMetrics, "overdue"> {
  startAt: string;
  /** Exclusive end of this seven-day bucket, clamped to the selected month. */
  endAt: string;
  label: string;
}

export interface MonthlyReport {
  month: string;
  timeZone: typeof REPORTING_TIME_ZONE;
  startAt: string;
  /** Exclusive end of the reporting month. */
  endAt: string;
  records: ReportRecord[];
  metrics: ReportMetrics;
  weeklySeries: ReportSeriesPoint[];
}

/** Only explicit, valid timezone-bearing timestamps are suitable for reporting. */
export function validReportTimestamp(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-](\d{2}):?(\d{2}))$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, , offsetHour, offsetMinute] = match;
  const daysInMonth = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  if (
    Number(month) < 1 || Number(month) > 12 || Number(day) < 1 ||
    Number(day) > daysInMonth || Number(hour) > 23 || Number(minute) > 59 ||
    Number(second ?? 0) > 59 || Number(offsetHour ?? 0) > 23 ||
    Number(offsetMinute ?? 0) > 59
  ) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function reportingMonthKey(value: Date | string | number): string {
  const timestamp = typeof value === "string"
    ? validReportTimestamp(value)
    : value instanceof Date ? value.getTime() : value;
  if (timestamp === null || !Number.isFinite(timestamp))
    throw new RangeError("Choose a valid reporting date.");
  const date = new Date(timestamp + REPORTING_OFFSET_MS);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthBounds(month: string): { start: number; end: number } {
  const match = /^([1-9]\d{3})-(0[1-9]|1[0-2])$/.exec(month);
  if (!match) throw new RangeError("Choose a reporting month in YYYY-MM format.");
  const year = Number(match[1]);
  const index = Number(match[2]) - 1;
  return {
    start: Date.UTC(year, index, 1) - REPORTING_OFFSET_MS,
    end: Date.UTC(year, index + 1, 1) - REPORTING_OFFSET_MS,
  };
}

export function shiftReportingMonth(month: string, amount: number): string {
  const { start } = monthBounds(month);
  if (!Number.isInteger(amount)) throw new RangeError("Month changes must be whole numbers.");
  const date = new Date(start + REPORTING_OFFSET_MS);
  date.setUTCMonth(date.getUTCMonth() + amount);
  return reportingMonthKey(date.getTime() - REPORTING_OFFSET_MS);
}

function cleanLifecycle(values: LifecycleTimestamps): ReportLifecycleTimestamps {
  const result: ReportLifecycleTimestamps = {};
  for (const milestone of milestones) {
    const timestamp = validReportTimestamp(values[milestone]);
    if (timestamp !== null) result[milestone] = new Date(timestamp).toISOString();
  }
  return result;
}

function requestLifecycle(request: MinistryRequest, task?: Task): ReportLifecycleTimestamps {
  return cleanLifecycle({
    ...task?.lifecycle,
    ...request.lifecycle,
    // createdAt is known submission metadata, not a guessed decision/start date.
    receivedAt: request.lifecycle?.receivedAt ?? request.createdAt,
    inProgressAt: task?.lifecycle?.inProgressAt ?? request.lifecycle?.inProgressAt,
    completedAt: task?.lifecycle?.completedAt ?? request.lifecycle?.completedAt,
  });
}

/** One row per request, plus tasks that do not already belong to a request row. */
export function buildReportRecords(state: Pick<WorkspaceState, "requests" | "tasks" | "catalog">): ReportRecord[] {
  const taskById = new Map(state.tasks.map((task) => [task.id, task]));
  const taskByRequest = new Map(state.tasks.filter((task) => task.requestId).map((task) => [task.requestId, task]));
  const serviceById = new Map(state.catalog.services.map((service) => [service.id, service]));
  const joinedTaskIds = new Set<string>();
  const records = state.requests.map((request): ReportRecord => {
    const linkedTask = request.taskId ? taskById.get(request.taskId) : undefined;
    const task = linkedTask && (!linkedTask.requestId || linkedTask.requestId === request.id)
      ? linkedTask : taskByRequest.get(request.id);
    if (task) joinedTaskIds.add(task.id);
    const service = serviceById.get(request.service);
    return {
      id: `request:${request.id}`,
      kind: "request",
      requestId: request.id,
      taskId: task?.id,
      reference: request.reference,
      title: task?.title ?? request.title,
      ministry: task?.ministry ?? request.ministry,
      service: task?.service ?? request.service,
      department: task?.department ?? service?.department ?? "",
      subTeam: task?.subTeam ?? service?.subTeam ?? "",
      dueAt: task?.dueAt ?? request.dueAt,
      status: request.status === "approved" ? task?.status ?? "approved" : request.status,
      lifecycle: requestLifecycle(request, task),
    };
  });
  for (const task of state.tasks) {
    if (joinedTaskIds.has(task.id)) continue;
    records.push({
      id: `task:${task.id}`,
      kind: "task",
      taskId: task.id,
      title: task.title,
      ministry: task.ministry,
      service: task.service,
      department: task.department,
      subTeam: task.subTeam,
      dueAt: task.dueAt,
      status: task.status,
      lifecycle: cleanLifecycle(task.lifecycle ?? {}),
    });
  }
  return records;
}

function inRange(value: unknown, start: number, end: number): boolean {
  const timestamp = validReportTimestamp(value);
  return timestamp !== null && timestamp >= start && timestamp < end;
}

function stageAverage(
  records: ReportRecord[],
  from: keyof LifecycleTimestamps,
  to: keyof LifecycleTimestamps,
  start: number,
  end: number,
): { average: number | null; samples: number } {
  let total = 0;
  let samples = 0;
  for (const record of records) {
    const first = validReportTimestamp(record.lifecycle[from]);
    const last = validReportTimestamp(record.lifecycle[to]);
    // The cohort is the ending milestone in the period, even if it began earlier.
    if (first === null || last === null || last < first || last < start || last >= end) continue;
    total += last - first;
    samples += 1;
  }
  return { average: samples ? total / samples : null, samples };
}

function periodMetrics(records: ReportRecord[], start: number, end: number, now: number): ReportMetrics {
  const requests = records.filter((record) => record.kind === "request");
  const approval = stageAverage(requests, "receivedAt", "approvedAt", start, end);
  const progress = stageAverage(records, "approvedAt", "inProgressAt", start, end);
  const completion = stageAverage(records, "inProgressAt", "completedAt", start, end);
  const total = stageAverage(records, "receivedAt", "completedAt", start, end);
  return {
    received: requests.filter((record) => inRange(record.lifecycle.receivedAt, start, end)).length,
    approved: requests.filter((record) => inRange(record.lifecycle.approvedAt, start, end)).length,
    rejected: requests.filter((record) => inRange(record.lifecycle.rejectedAt, start, end)).length,
    inProgress: records.filter((record) => inRange(record.lifecycle.inProgressAt, start, end)).length,
    completed: records.filter((record) => inRange(record.lifecycle.completedAt, start, end)).length,
    overdue: records.filter((record) => {
      const due = validReportTimestamp(record.dueAt);
      return record.taskId && record.status !== "completed" && record.status !== "rejected" &&
        due !== null && due >= start && due < end && due < now;
    }).length,
    averageApprovalMs: approval.average,
    averageStartMs: progress.average,
    averageCompletionMs: completion.average,
    averageTotalMs: total.average,
    approvalSamples: approval.samples,
    startSamples: progress.samples,
    completionSamples: completion.samples,
    totalSamples: total.samples,
  };
}

export function createMonthlyReport(
  state: Pick<WorkspaceState, "requests" | "tasks" | "catalog">,
  month: string,
  now: Date | number = Date.now(),
): MonthlyReport {
  const { start, end } = monthBounds(month);
  const nowTimestamp = now instanceof Date ? now.getTime() : now;
  if (!Number.isFinite(nowTimestamp)) throw new RangeError("Choose a valid current reporting date.");
  const allRecords = buildReportRecords(state);
  const records = allRecords.filter((record) =>
    inRange(record.dueAt, start, end) || milestones.some((milestone) => inRange(record.lifecycle[milestone], start, end)),
  );
  const weeklySeries: ReportSeriesPoint[] = [];
  const monthLabel = new Intl.DateTimeFormat("en-ZA", { month: "short", timeZone: REPORTING_TIME_ZONE }).format(start);
  for (let bucketStart = start; bucketStart < end; bucketStart += 7 * DAY_MS) {
    const bucketEnd = Math.min(bucketStart + 7 * DAY_MS, end);
    const firstDay = new Date(bucketStart + REPORTING_OFFSET_MS).getUTCDate();
    const lastDay = new Date(bucketEnd - 1 + REPORTING_OFFSET_MS).getUTCDate();
    const { overdue: _overdue, ...metrics } = periodMetrics(allRecords, bucketStart, bucketEnd, nowTimestamp);
    weeklySeries.push({
      startAt: new Date(bucketStart).toISOString(),
      endAt: new Date(bucketEnd).toISOString(),
      label: `${firstDay}–${lastDay} ${monthLabel}`,
      ...metrics,
    });
  }
  return {
    month,
    timeZone: REPORTING_TIME_ZONE,
    startAt: new Date(start).toISOString(),
    endAt: new Date(end).toISOString(),
    records,
    metrics: periodMetrics(allRecords, start, end, nowTimestamp),
    weeklySeries,
  };
}
