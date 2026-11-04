import { X509Certificate } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { databaseConnectionOptions, supabaseRootCertificate } from "./database-config";
afterEach(() => vi.unstubAllEnvs());
describe("Supabase database TLS", () => {
  it("pins the provider CA while preserving hostname verification", () => {
    const options = databaseConnectionOptions("postgresql://postgres:password@db.project.supabase.co:5432/postgres?sslmode=no-verify&application_name=moc");
    expect(options.ssl).toEqual({ ca: supabaseRootCertificate, rejectUnauthorized: true });
    const url = new URL(options.connectionString);
    expect(url.hostname).toBe("db.project.supabase.co");
    expect(url.searchParams.has("sslmode")).toBe(false);
    expect(url.searchParams.get("application_name")).toBe("moc");
    expect(new X509Certificate(supabaseRootCertificate).fingerprint256).toBe("80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA");
  });
  it("supports disposable local Postgres without weakening production connections", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(databaseConnectionOptions("postgresql://test@localhost/postgres?host=%2Ftmp%2Fmoc").ssl).toBeUndefined();
    vi.stubEnv("NODE_ENV", "production");
    expect(databaseConnectionOptions("postgresql://test@localhost/postgres").ssl?.rejectUnauthorized).toBe(true);
  });
});
