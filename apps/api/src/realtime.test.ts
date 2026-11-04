import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { Pool } from "pg";
import type { SupabaseClient } from "@supabase/supabase-js";
import { workspaceEvents } from "./realtime";

afterEach(() => vi.useRealTimers());
function harness(rows: unknown[] = [{ id: "moc", revision: "1" }]) {
  const callbacks: { filter: Record<string, string>; callback: (payload: { new: Record<string, unknown>; old: Record<string, unknown> }) => void }[] = [];
  let subscribed!: (status: string) => void;
  const channel = { on: vi.fn((_type, filter, callback) => { callbacks.push({ filter, callback }); return channel; }), subscribe: vi.fn((callback) => { subscribed = callback; return channel; }) };
  const client = { channel: () => channel, removeChannel: vi.fn().mockResolvedValue("ok"), realtime: { disconnect: vi.fn() } };
  const query = vi.fn().mockResolvedValue({ rows });
  const stream = workspaceEvents({ query } as unknown as Pool, () => client as unknown as SupabaseClient);
  const app = new Hono().get("/events", (c) => stream(c, "member-1"));
  return { callbacks, status: (value: string) => subscribed(value), client, query, app };
}
async function read(reader: ReadableStreamDefaultReader<Uint8Array>) { return new TextDecoder().decode((await reader.read()).value); }

describe("server-side Supabase to API event stream", () => {
  it("subscribes before its bounded snapshot; only forwards this member, deduplicates ordinary edits, and cleans up", async () => {
    const h = harness();
    const response = await h.app.request("/events");
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("cache-control")).toContain("no-store");
    const reader = response.body!.getReader();
    expect(h.query).not.toHaveBeenCalled();
    h.status("SUBSCRIBED");
    expect(await read(reader)).toContain('"revision":"1"');
    expect(h.query).toHaveBeenCalledTimes(1);
    h.callbacks[0]!.callback({ new: { workspace_id: "moc", member_id: "other-member", approved: true, live_revision: 10 }, old: {} });
    h.callbacks[0]!.callback({ new: { workspace_id: "moc", member_id: "member-1", approved: true, live_revision: 1 }, old: {} });
    h.callbacks[0]!.callback({ new: { workspace_id: "moc", member_id: "member-1", approved: true, live_revision: 2 }, old: {} });
    expect(await read(reader)).toContain('"revision":"2"');
    expect(h.query).toHaveBeenCalledTimes(1);
    await reader.cancel();
    await vi.waitFor(() => expect(h.client.removeChannel).toHaveBeenCalledTimes(1));
    expect(h.client.realtime.disconnect).toHaveBeenCalled();
  });
  it.each(["revoked", "deleted", "missing"])("closes when membership is %s", async (kind) => {
    const h = harness(kind === "missing" ? [] : undefined);
    const response = await h.app.request("/events");
    const reader = response.body!.getReader();
    h.status("SUBSCRIBED");
    if (kind !== "missing") {
      await read(reader);
      if (kind === "revoked") h.callbacks[0]!.callback({ new: { workspace_id: "moc", member_id: "member-1", approved: false, live_revision: 1 }, old: {} });
      else h.callbacks[1]!.callback({ new: {}, old: { workspace_id: "moc", member_id: "member-1" } });
    }
    expect(await read(reader)).toContain("event: revoked");
    expect((await reader.read()).done).toBe(true);
    expect(h.client.removeChannel).toHaveBeenCalledTimes(1);
  });
  it("keeps heartbeat traffic off the database", async () => {
    vi.useFakeTimers();
    const h = harness();
    const response = await h.app.request("/events");
    const reader = response.body!.getReader();
    h.status("SUBSCRIBED");
    await read(reader);
    await vi.advanceTimersByTimeAsync(25_000);
    expect(await read(reader)).toContain("event: heartbeat");
    expect(h.query).toHaveBeenCalledTimes(1);
    await reader.cancel();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.client.removeChannel).toHaveBeenCalledTimes(1);
  });
  it("ends the server stream after four minutes so a fresh request revalidates access", async () => {
    vi.useFakeTimers();
    const h = harness();
    const response = await h.app.request("/events");
    const reader = response.body!.getReader();
    h.status("SUBSCRIBED");
    await read(reader);
    await vi.advanceTimersByTimeAsync(240_000);
    while (!(await reader.read()).done) { /* drain bounded heartbeats */ }
    expect(h.query).toHaveBeenCalledTimes(1);
    expect(h.client.removeChannel).toHaveBeenCalledTimes(1);
    expect(h.client.realtime.disconnect).toHaveBeenCalled();
  });
  it("reports provider failure without sending an error, SQL, or credentials to the browser", async () => {
    const h = harness();
    const response = await h.app.request("/events");
    const reader = response.body!.getReader();
    h.status("CHANNEL_ERROR");
    expect(await read(reader)).toBe("event: paused\ndata: {}\n\n");
    expect((await reader.read()).done).toBe(true);
  });
});
