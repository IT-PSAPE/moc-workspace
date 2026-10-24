import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export interface ReportStorage {
  save(memberId: string, month: string, csv: string): Promise<{ id: string; filename: string; url: string }>;
}

export class NeonReportStorage implements ReportStorage {
  private readonly s3 = new S3Client({ forcePathStyle: true, requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED" });
  constructor(private readonly pool: Pool, private readonly workspaceId = "moc", private readonly bucket = "assets") {}

  async save(memberId: string, month: string, csv: string) {
    const id = randomUUID();
    const filename = `moc-report-${month}.csv`;
    const key = `reports/${this.workspaceId}/${id}/${filename}`;
    await this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: csv, ContentType: "text/csv; charset=utf-8", ContentDisposition: `attachment; filename="${filename}"` }));
    try {
      await this.pool.query("INSERT INTO moc.report_exports (id, workspace_id, member_id, object_key, filename) VALUES ($1, $2, $3, $4, $5)", [id, this.workspaceId, memberId, key, filename]);
    } catch (error) {
      await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key })).catch(() => undefined);
      throw error;
    }
    const url = await getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn: 60 });
    return { id, filename, url };
  }
}
