import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface ReportStorage {
  save(memberId: string, month: string, csv: string): Promise<{ id: string; filename: string; url: string }>;
  download(id: string): Promise<{ filename: string; data: Blob } | null>;
}

/** The bucket is private. Download bytes are served by an authorized API route. */
export class SupabaseReportStorage implements ReportStorage {
  constructor(private readonly pool: Pool, private readonly supabase: SupabaseClient, private readonly workspaceId = "moc", private readonly bucket = process.env.SUPABASE_REPORT_BUCKET || "moc-reports") {}

  async save(memberId: string, month: string, csv: string) {
    const id = randomUUID();
    const filename = `moc-report-${month}.csv`;
    const key = `reports/${this.workspaceId}/${id}/${filename}`;
    const { error } = await this.supabase.storage.from(this.bucket).upload(key, Buffer.from(csv, "utf8"), { contentType: "text/csv; charset=utf-8", upsert: false });
    if (error) throw new Error("Could not store the report. Please retry.");
    try {
      await this.pool.query("INSERT INTO moc.report_exports (id, workspace_id, member_id, object_key, filename) VALUES ($1, $2, $3, $4, $5)", [id, this.workspaceId, memberId, key, filename]);
    } catch (error) {
      await this.supabase.storage.from(this.bucket).remove([key]).catch(() => undefined);
      throw error;
    }
    return { id, filename, url: `/api/reports/${id}/download` };
  }

  async download(id: string) {
    const result = await this.pool.query("SELECT object_key, filename FROM moc.report_exports WHERE id = $1 AND workspace_id = $2", [id, this.workspaceId]);
    const report = result.rows[0];
    if (!report) return null;
    const { data, error } = await this.supabase.storage.from(this.bucket).download(report.object_key);
    if (error || !data) throw new Error("Could not retrieve the report. Please retry.");
    return { filename: report.filename as string, data };
  }
}
