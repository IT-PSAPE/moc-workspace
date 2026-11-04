import { randomUUID } from "node:crypto";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import type { Pool } from "pg";
import { postgresChangesFilter, type SupabaseClient } from "@supabase/supabase-js";

export interface WorkspaceRevision { id: string; revision: string }
export const workspaceLiveSql = `SELECT member.workspace_id AS id, member.live_revision AS revision
  FROM moc.workspace_members AS member
  WHERE member.workspace_id = $1 AND member.member_id = $2 AND member.approved = true`;

/** Supabase's connection stays on the server. The browser receives only its own
 * tiny revision signal, never SQL capabilities, database rows or service keys. */
export function workspaceEvents(pool: Pool, clientFor: () => SupabaseClient, workspaceId = "moc") {
  return async (c: Context, memberId: string): Promise<Response> => {
    c.header("Cache-Control", "private, no-store");
    c.header("X-Accel-Buffering", "no");
    const response = streamSSE(c, async (stream) => {
      const client = clientFor();
      let stopped = false;
      let lastRevision: string | undefined;
      let resolveDone!: () => void;
      const done = new Promise<void>((resolve) => { resolveDone = resolve; });
      const stop = () => { stopped = true; resolveDone(); };
      // Bound each serverless invocation. A new request revalidates both the
      // Supabase session and current workspace membership before reconnecting.
      const expiry = setTimeout(stop, 240_000);
      const connectionDeadline = setTimeout(() => { void failed(); }, 15_000);
      const heartbeat = setInterval(() => {
        if (!stopped) void stream.writeSSE({ event: "heartbeat", data: "{}" }).catch(stop);
      }, 25_000);
      stream.onAbort(stop);
      const send = async (row?: Record<string, unknown>) => {
        if (stopped) return;
        if (!row || row.approved === false) {
          await stream.writeSSE({ event: "revoked", data: "{}" });
          stop(); return;
        }
        const revision = String(row.live_revision ?? row.revision);
        if (lastRevision !== undefined && /^\d+$/.test(revision) && /^\d+$/.test(lastRevision) && BigInt(revision) <= BigInt(lastRevision)) return;
        lastRevision = revision;
        await stream.writeSSE({ event: "revision", data: JSON.stringify({ id: workspaceId, revision }) });
      };
      const channel = client.channel(`workspace:${randomUUID()}`)
        .on("postgres_changes", { event: "UPDATE", schema: "moc", table: "workspace_members", filter: postgresChangesFilter().eq("workspace_id", workspaceId).eq("member_id", memberId).toString() }, (payload) => {
          const row = payload.new;
          if (row.workspace_id === workspaceId && row.member_id === memberId) void send(row).catch(stop);
        })
        // DELETE events cannot be filtered; only composite primary keys are
        // needed to revoke a removed member. No private workspace is published.
        .on("postgres_changes", { event: "DELETE", schema: "moc", table: "workspace_members" }, (payload) => {
          if (payload.old.workspace_id === workspaceId && payload.old.member_id === memberId) void send().catch(stop);
        });
      const failed = async () => {
        if (stopped) return;
        await stream.writeSSE({ event: "paused", data: "{}" }).catch(() => undefined);
        stop();
      };
      try {
        channel.subscribe((status) => {
          if (status === "SUBSCRIBED") {
            clearTimeout(connectionDeadline);
            // Subscribe before the initial snapshot to close the fetch/subscribe
            // race. This is one bounded row, not a recurring database poll.
            void pool.query(workspaceLiveSql, [workspaceId, memberId])
              .then((result) => result.rows[0] ? send({ ...result.rows[0], approved: true }) : send())
              .catch(failed);
          } else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) void failed();
        });
        await done;
      } finally {
        stopped = true;
        clearTimeout(expiry); clearTimeout(connectionDeadline); clearInterval(heartbeat);
        await client.removeChannel(channel);
        client.realtime.disconnect();
      }
    });
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  };
}
