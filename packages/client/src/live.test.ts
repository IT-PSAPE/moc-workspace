import { afterEach, describe, expect, it, vi } from "vitest";
import { subscribeWorkspaceEvents } from "./live";
import { WORKSPACE_FALLBACK_INTERVAL_MS } from "./query-policy";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const encoder = new TextEncoder();
function liveResponse() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({ start(c) { controller = c; }, cancel });
  return { response: new Response(body, { headers: { "content-type": "text/event-stream" } }), send: (text: string) => controller.enqueue(encoder.encode(text)), close: () => controller.close(), cancel };
}

describe("API-only client live transport", () => {
  it("parses split frames, deduplicates revisions across connection renewal, and stops when hidden", async () => {
    vi.useFakeTimers();
    const first = liveResponse(), second = liveResponse();
    const fetch = vi.fn().mockResolvedValueOnce(first.response).mockResolvedValueOnce(second.response);
    vi.stubGlobal("fetch", fetch);
    const signal = vi.fn();
    const stop = subscribeWorkspaceEvents("/api/workspace/events", signal);
    first.send('event: revision\ndata: {"revision":"1"');
    await vi.advanceTimersByTimeAsync(0);
    expect(signal).not.toHaveBeenCalled();
    first.send('}\n\nevent: heartbeat\ndata: {}\n\n');
    await vi.advanceTimersByTimeAsync(0);
    expect(signal).toHaveBeenCalledWith({ event: "revision", revision: "1" });
    first.close();
    await vi.advanceTimersByTimeAsync(1000);
    second.send('event: revision\ndata: {"revision":"1"}\n\n');
    await vi.advanceTimersByTimeAsync(0);
    expect(signal.mock.calls.filter(([value]) => value.event === "revision")).toHaveLength(1);
    second.send('event: revision\ndata: {"revision":"2"}\n\n');
    await vi.advanceTimersByTimeAsync(0);
    expect(signal).toHaveBeenCalledWith({ event: "revision", revision: "2" });
    stop();
    expect(fetch.mock.calls[0]![1].signal.aborted).toBe(true);
    second.close();
    await vi.advanceTimersByTimeAsync(2 * WORKSPACE_FALLBACK_INTERVAL_MS);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it.each([401, 403, 402, 429])("never loops after HTTP %s", async (status) => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockResolvedValue(new Response("{}", { status })); vi.stubGlobal("fetch", fetch);
    const signal = vi.fn();
    const stop = subscribeWorkspaceEvents("/api/workspace/events", signal);
    await vi.advanceTimersByTimeAsync(2 * WORKSPACE_FALLBACK_INTERVAL_MS);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(signal).toHaveBeenCalledWith({ event: [401, 403].includes(status) ? "revoked" : "paused" });
    stop();
  });
  it("uses the 15-minute retry for service failures and aborts the reconnect timer", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockResolvedValue(new Response("{}", { status: 503 })); vi.stubGlobal("fetch", fetch);
    const stop = subscribeWorkspaceEvents("/api/workspace/events", vi.fn());
    await vi.advanceTimersByTimeAsync(WORKSPACE_FALLBACK_INTERVAL_MS - 1);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    stop();
    await vi.advanceTimersByTimeAsync(WORKSPACE_FALLBACK_INTERVAL_MS);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("handles server revocation without reconnecting or polling", async () => {
    vi.useFakeTimers();
    const live = liveResponse();
    const fetch = vi.fn().mockResolvedValue(live.response); vi.stubGlobal("fetch", fetch);
    const signal = vi.fn();
    const stop = subscribeWorkspaceEvents("/api/workspace/events", signal);
    live.send("event: revoked\ndata: {}\n\n");
    await vi.advanceTimersByTimeAsync(2 * WORKSPACE_FALLBACK_INTERVAL_MS);
    expect(signal).toHaveBeenCalledWith({ event: "revoked" });
    expect(live.cancel).toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
    stop();
  });
  it("cancels unread error bodies so failed streams do not hold browser connections open", async () => {
    vi.useFakeTimers();
    const cancelled = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel: cancelled });
    const fetch = vi.fn().mockResolvedValue(new Response(body, { status: 503 }));
    vi.stubGlobal("fetch", fetch);
    const signal = vi.fn();
    const stop = subscribeWorkspaceEvents("/api/workspace/events", signal);
    await vi.advanceTimersByTimeAsync(0);
    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(signal).toHaveBeenCalledWith({ event: "paused" });
    stop();
  });

});
