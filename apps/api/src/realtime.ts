import { createRealtime, rawSql } from "@neon/realtime/server";

export interface WorkspaceRevision { id: string; revision: string }

export const workspaceLiveSql = `SELECT member.workspace_id AS id, member.live_revision AS revision
  FROM moc.workspace_members AS member
  WHERE member.workspace_id = $1 AND member.member_id = $2 AND member.approved = true`;

export function workspaceRealtime(workspaceId = "moc") {
  const secret = process.env.NEON_REALTIME_SECRET || process.env.MOC_REALTIME_SECRET;
  if (!secret) throw new Error("Realtime sealing secret is missing in the API runtime.");
  if (!process.env.DATABASE_URL) throw new Error("Realtime requires DATABASE_URL in the API runtime.");
  const realtime = createRealtime({
    secret,
    db: new URL(process.env.DATABASE_URL).pathname.slice(1),
  });
  return (memberId: string) => realtime.seal({ query: rawSql<WorkspaceRevision>(
    workspaceLiveSql,
    [workspaceId, memberId],
  ) });
}
