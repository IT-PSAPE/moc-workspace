import { describe, expect, it } from "vitest";
import {
  buildReportRecords,
  createMonthlyReport,
  reportingMonthKey,
  shiftReportingMonth,
  validReportTimestamp,
} from "../packages/shared/src";
import type { Catalog, LifecycleTimestamps, MinistryRequest, Task } from "../packages/shared/src";

const HOUR = 3_600_000;
const catalog: Catalog = {
  ministries: ["Youth"],
  departments: [{ id: "design", name: "Design", groups: ["Graphics"], color: "purple" }],
  services: [{ id: "graphics", name: "Graphics", department: "design", subTeam: "Graphics" }],
};

function request(id: string, overrides: Partial<MinistryRequest> = {}): MinistryRequest {
  return {
    id,
    reference: `MOC-${id}`,
    title: `Request ${id}`,
    ministry: "Youth",
    service: "graphics",
    instructions: "Create the requested graphic.",
    notes: "",
    dueAt: "2026-10-20T10:00:00Z",
    status: "backlog",
    createdAt: "2026-10-01T08:00:00Z",
    updatedAt: "2026-10-15T08:00:00Z",
    ...overrides,
  };
}

function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    title: `Task ${id}`,
    ministry: "Youth",
    service: "graphics",
    instructions: "Create the requested graphic.",
    notes: "",
    department: "design",
    subTeam: "Graphics",
    status: "pending",
    dueAt: "2026-10-20T10:00:00Z",
    createdAt: "2026-10-01T10:00:00Z",
    privateNotes: [],
    ...overrides,
  };
}

describe("reporting periods", () => {
  it("uses Johannesburg boundaries rather than the host timezone", () => {
    expect(reportingMonthKey("2026-09-30T21:59:59.999Z")).toBe("2026-09");
    expect(reportingMonthKey("2026-09-30T22:00:00Z")).toBe("2026-10");
    expect(reportingMonthKey(new Date("2026-10-31T22:00:00Z"))).toBe("2026-11");
    const result = createMonthlyReport({ catalog, requests: [], tasks: [] }, "2026-10");
    expect(result.startAt).toBe("2026-09-30T22:00:00.000Z");
    expect(result.endAt).toBe("2026-10-31T22:00:00.000Z");
    expect(result.timeZone).toBe("Africa/Johannesburg");
    expect(result.weeklySeries.map((bucket) => bucket.label)).toEqual([
      "1–7 Oct", "8–14 Oct", "15–21 Oct", "22–28 Oct", "29–31 Oct",
    ]);
    expect(result.weeklySeries.at(-1)?.endAt).toBe(result.endAt);
  });

  it("handles leap years and year changes and rejects invalid period arguments", () => {
    expect(shiftReportingMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftReportingMonth("2026-01", -1)).toBe("2025-12");
    const leap = createMonthlyReport({ catalog, requests: [], tasks: [] }, "2028-02");
    expect(leap.startAt).toBe("2028-01-31T22:00:00.000Z");
    expect(leap.endAt).toBe("2028-02-29T22:00:00.000Z");
    expect(leap.weeklySeries.at(-1)?.label).toBe("29–29 Feb");
    expect(() => createMonthlyReport({ catalog, requests: [], tasks: [] }, "2026-13")).toThrow(RangeError);
    expect(() => shiftReportingMonth("2026-10", 0.5)).toThrow(RangeError);
    expect(() => reportingMonthKey(new Date("invalid"))).toThrow(RangeError);
    expect(() => reportingMonthKey("2026-10-01T00:00:00")).toThrow(RangeError);
    expect(() => createMonthlyReport({ catalog, requests: [], tasks: [] }, "2026-10", NaN)).toThrow(RangeError);
  });

  it("rejects malformed, impossible and timezone-ambiguous timestamps", () => {
    for (const value of [
      undefined, null, "", "invalid", "2026-10-01", "2026-10-01T10:00:00",
      "2026-02-29T10:00:00Z", "2026-04-31T10:00:00Z", "2026-10-01T24:00:00Z",
      "2026-10-01T00:60:00Z", "2026-10-01T00:00:60Z", "2026-10-01T00:00:00+99:00",
    ]) expect(validReportTimestamp(value), String(value)).toBeNull();
    expect(validReportTimestamp("2028-02-29T10:00:00+02:00")).toBe(Date.parse("2028-02-29T08:00:00Z"));
    expect(validReportTimestamp("2026-10-01T10:00+0200")).toBe(Date.parse("2026-10-01T08:00:00Z"));
  });
});

describe("report records", () => {
  it("joins approved request tasks once and retains backlog, rejection and standalone task rows", () => {
    const received = request("received");
    const approved = request("approved", {
      status: "approved",
      lifecycle: { receivedAt: "2026-10-01T08:00:00Z", approvedAt: "2026-10-02T08:00:00Z" },
    });
    const rejected = request("rejected", { status: "rejected" });
    const linked = task("linked", {
      requestId: approved.id,
      status: "in-progress",
      lifecycle: { inProgressAt: "2026-10-03T08:00:00Z" },
    });
    const internal = task("internal");
    const orphan = task("orphan", { requestId: "missing-request" });
    const records = buildReportRecords({ catalog, requests: [received, approved, rejected], tasks: [linked, internal, orphan] });
    expect(records).toHaveLength(5);
    expect(records.map((row) => row.status)).toEqual(["backlog", "in-progress", "rejected", "pending", "pending"]);
    expect(records[0]).toMatchObject({ department: "design", subTeam: "Graphics", lifecycle: { receivedAt: new Date(received.createdAt).toISOString() } });
    expect(records[1]).toMatchObject({
      requestId: approved.id,
      taskId: linked.id,
      title: linked.title,
      lifecycle: {
        receivedAt: "2026-10-01T08:00:00.000Z",
        approvedAt: "2026-10-02T08:00:00.000Z",
        inProgressAt: "2026-10-03T08:00:00.000Z",
      },
    });
    expect(records[3].lifecycle).toEqual({});
    expect(records[4].taskId).toBe(orphan.id);
    expect(approved.lifecycle).toEqual({ receivedAt: "2026-10-01T08:00:00Z", approvedAt: "2026-10-02T08:00:00Z" });
  });

  it("does not infer historical decisions or execution dates from status, due date or updatedAt", () => {
    const state = {
      catalog,
      requests: [request("old", { status: "approved", taskId: "old-task" })],
      tasks: [task("old-task", { status: "completed", requestId: "old" })],
    };
    const report = createMonthlyReport(state, "2026-10");
    expect(report.records[0].lifecycle).toEqual({ receivedAt: "2026-10-01T08:00:00.000Z" });
    expect(report.metrics).toMatchObject({
      received: 1, approved: 0, rejected: 0, inProgress: 0, completed: 0,
      approvalSamples: 0, startSamples: 0, completionSamples: 0, totalSamples: 0,
      averageApprovalMs: null, averageStartMs: null, averageCompletionMs: null, averageTotalMs: null,
    });
  });

  it("ignores a malformed explicit milestone rather than silently substituting another date", () => {
    const row = buildReportRecords({ catalog, requests: [request("invalid", {
      lifecycle: { receivedAt: "invalid", approvedAt: "2026-02-30T10:00:00Z" },
    })], tasks: [] })[0];
    expect(row.lifecycle).toEqual({});
  });
});

describe("monthly lifecycle analytics", () => {
  it("counts first milestones within the period and averages only valid ending-stage cohorts", () => {
    const deliveredLifecycle: LifecycleTimestamps = {
      receivedAt: "2026-09-30T20:00:00Z",
      approvedAt: "2026-10-01T00:00:00Z",
      inProgressAt: "2026-10-02T00:00:00Z",
      completedAt: "2026-10-04T00:00:00Z",
    };
    const delivered = request("delivered", { status: "approved", lifecycle: deliveredLifecycle });
    const recovered = request("recovered", {
      status: "approved",
      createdAt: "2026-10-10T00:00:00Z",
      lifecycle: { receivedAt: "2026-10-10T00:00:00Z", rejectedAt: "2026-10-11T00:00:00Z", approvedAt: "2026-10-13T00:00:00Z" },
    });
    const rejected = request("rejected", {
      status: "rejected",
      createdAt: "2026-09-29T00:00:00Z",
      lifecycle: { rejectedAt: "2026-10-02T00:00:00Z" },
    });
    const legacy = request("legacy", { createdAt: "2026-10-20T00:00:00Z", status: "approved" });
    const internal = task("internal", {
      status: "completed",
      lifecycle: {
        receivedAt: "2026-10-02T00:00:00Z", approvedAt: "2026-10-02T00:00:00Z",
        inProgressAt: "2026-10-03T00:00:00Z", completedAt: "2026-10-05T00:00:00Z",
      },
    });
    const state = { catalog, requests: [delivered, recovered, rejected, legacy], tasks: [
      task("delivered-task", { requestId: delivered.id, status: "completed", lifecycle: deliveredLifecycle }), internal,
    ] };
    const report = createMonthlyReport(state, "2026-10", Date.parse("2026-10-24T00:00:00Z"));
    expect(report.metrics).toEqual({
      received: 2, approved: 2, rejected: 2, inProgress: 2, completed: 2, overdue: 0,
      averageApprovalMs: 38 * HOUR, averageStartMs: 24 * HOUR,
      averageCompletionMs: 48 * HOUR, averageTotalMs: 74 * HOUR,
      approvalSamples: 2, startSamples: 2, completionSamples: 2, totalSamples: 2,
    });
    expect(report.weeklySeries.map((bucket) => [bucket.approved, bucket.rejected])).toEqual([
      [1, 1], [1, 1], [0, 0], [0, 0], [0, 0],
    ]);
    expect(report.weeklySeries.reduce((sum, bucket) => sum + bucket.received, 0)).toBe(report.metrics.received);
    expect(report.weeklySeries[0].averageApprovalMs).toBe(4 * HOUR);
    expect(report.weeklySeries[1].averageApprovalMs).toBe(72 * HOUR);
    // A rejected request that later gets approved contributes to both decision counts.
    expect(report.records.find((row) => row.requestId === recovered.id)?.lifecycle.rejectedAt).toBeTruthy();
  });

  it("excludes missing, reversed and invalid timestamp pairs and accepts a genuine zero duration", () => {
    const lifecycleRows: LifecycleTimestamps[] = [
      { receivedAt: "2026-10-02T00:00:00Z", approvedAt: "2026-10-01T00:00:00Z" },
      { receivedAt: "invalid", approvedAt: "2026-10-03T00:00:00Z" },
      { receivedAt: "2026-10-03T00:00:00Z" },
      { receivedAt: "2026-10-03T00:00:00Z", approvedAt: "2026-10-03T00:00:00Z" },
    ];
    const report = createMonthlyReport({ catalog, requests: lifecycleRows.map((lifecycle, i) => request(String(i), { lifecycle })), tasks: [
      task("reversed", { lifecycle: { approvedAt: "2026-10-04T00:00:00Z", inProgressAt: "2026-10-03T00:00:00Z", completedAt: "2026-10-02T00:00:00Z" } }),
    ] }, "2026-10");
    expect(report.metrics).toMatchObject({
      approved: 3,
      approvalSamples: 1, averageApprovalMs: 0,
      startSamples: 0, averageStartMs: null,
      completionSamples: 0, averageCompletionMs: null,
      totalSamples: 0, averageTotalMs: null,
    });
  });

  it("includes rows by actual milestone or due date and uses half-open month boundaries", () => {
    const state = { catalog, requests: [
      request("start", { dueAt: "2026-12-01T00:00:00Z", createdAt: "2026-09-30T22:00:00Z" }),
      request("end", { dueAt: "2026-12-01T00:00:00Z", createdAt: "2026-10-31T22:00:00Z" }),
      request("before", { dueAt: "2026-12-01T00:00:00Z", createdAt: "2026-09-30T21:59:59.999Z" }),
      request("due-only", { dueAt: "2026-10-31T21:59:59.999Z", createdAt: "2026-08-01T00:00:00Z" }),
    ], tasks: [] };
    const report = createMonthlyReport(state, "2026-10");
    expect(report.records.map((row) => row.requestId)).toEqual(["start", "due-only"]);
    expect(report.metrics.received).toBe(1);
    expect(report.weeklySeries[0].received).toBe(1);
    expect(report.weeklySeries.at(-1)?.received).toBe(0);
  });

  it("counts only open routed tasks as overdue, without treating missing timestamps as zero", () => {
    const report = createMonthlyReport({ catalog, requests: [request("backlog"), request("rejected", { status: "rejected", taskId: "rejected-task" })], tasks: [
      task("pending"), task("working", { status: "in-progress" }),
      task("completed", { status: "completed" }),
      task("rejected-task", { requestId: "rejected" }),
      task("future", { dueAt: "2026-10-25T00:00:00Z" }),
      task("last-month", { dueAt: "2026-09-25T00:00:00Z" }),
    ] }, "2026-10", new Date("2026-10-24T00:00:00Z"));
    expect(report.metrics.overdue).toBe(2);
    expect(report.metrics.averageCompletionMs).toBeNull();
    expect(report.metrics.completed).toBe(0);
  });
});
