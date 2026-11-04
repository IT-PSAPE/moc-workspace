import { describe, expect, it } from "vitest";
import { isPermanentRequestError, retryQuery, workspaceRefetchInterval } from "./query-policy";

describe("query traffic policy", () => {
  it.each([400, 401, 402, 403, 404, 422])("does not retry permanent HTTP %s failures", (status) => {
    expect(retryQuery(0, { status })).toBe(false);
    expect(workspaceRefetchInterval({ status })).toBe(false);
  });

  it("stops automatic traffic when quota errors arrive from either Auth or the API", () => {
    for (const failure of [
      { code: "GENERIC_QUOTA_EXCEEDED", status: 402 },
      { status: 500, message: "Your account or project has exceeded the quota. Upgrade your plan to increase limits." },
    ]) {
      expect(isPermanentRequestError(failure)).toBe(true);
      expect(retryQuery(0, failure)).toBe(false);
      expect(workspaceRefetchInterval(failure)).toBe(false);
    }
  });

  it.each([new Error("Network failure"), { status: 408 }, { status: 429 }, { status: 500 }, { status: 503 }])("allows one retry for a transient failure: %j", (failure) => {
    expect(retryQuery(0, failure)).toBe(true);
    expect(retryQuery(1, failure)).toBe(false);
    expect(workspaceRefetchInterval(failure, new Date("2026-10-29T10:00:00Z"))).toBe(900_000);
  });

  it("refreshes non-priority changes every fifteen minutes even with a live connection", () => {
    const now = new Date("2026-10-29T21:00:00Z");
    expect(workspaceRefetchInterval(null, now)).toBe(900_000);
  });

  it("refreshes at Johannesburg midnight even when the fallback interval is longer", () => {
    const now = new Date("2026-10-29T21:59:58Z");
    expect(workspaceRefetchInterval(null, now)).toBe(2_000);
  });
});
