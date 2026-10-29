import { millisecondsUntilNextQuoteDay } from "@moc/shared";

export const WORKSPACE_FALLBACK_INTERVAL_MS = 5 * 60_000;
export const PUBLIC_CATALOG_REFRESH_MS = 15 * 60_000;

export function isPermanentRequestError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const failure = error as { status?: number; code?: string; message?: string };
  return failure.code === "GENERIC_QUOTA_EXCEEDED" ||
    /quota.*exceeded|exceeded.*quota/i.test(failure.message ?? "") ||
    (typeof failure.status === "number" && failure.status >= 400 && failure.status < 500 &&
      failure.status !== 408 && failure.status !== 429);
}

export function retryQuery(failureCount: number, error: unknown): boolean {
  return failureCount < 1 && !isPermanentRequestError(error);
}

export function workspaceRefetchInterval(live: boolean, error: unknown, now = new Date()): number | false {
  if (isPermanentRequestError(error)) return false;
  return Math.min(live ? Infinity : WORKSPACE_FALLBACK_INTERVAL_MS, millisecondsUntilNextQuoteDay(now));
}
