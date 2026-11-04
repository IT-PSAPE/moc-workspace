import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiApp } from "./index";
import { JsonRepository } from "./repository";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

async function harness(role: "leader" | "member" | "anonymous" = "leader") {
  const directory = await mkdtemp(join(tmpdir(), "moc-report-storage-"));
  directories.push(directory);
  const repository = new JsonRepository(join(directory, "state.json"));
  const user = (await repository.read()).users.find((user) => user.department === "cell-0")!;
  if (role === "member") await repository.update((state) => ({ ...state, users: state.users.map((item) => item.id === user.id ? { ...item, isLeader: false } : item) }));
  const save = vi.fn().mockResolvedValue({ id: "export", filename: "moc-report-2026-10.csv", url: "/api/reports/840d43c6-e0ef-488b-912a-9dd27794d25f/download" });
  const app = createApiApp(repository, { resolveSession: async () => ({ user: role === "anonymous" ? null : user, demo: false }), reportStorage: { save, download: vi.fn().mockResolvedValue({ filename: "moc-report-2026-10.csv", data: new Blob(["Task,Status\r\nTest,Completed"]) }) }, storage: "supabase-postgres" });
  const request = (body: unknown = { month: "2026-10", csv: "Task,Status\r\nTest,Completed" }) => app.request("/api/reports/export", { method: "POST", headers: { origin: "http://localhost:5173", "content-type": "application/json" }, body: JSON.stringify(body) });
  return { app, request, save, user };
}

describe("private report exports", () => {
  it("stores an approved Cell 0 leader's report and returns an API download", async () => {
    const { request, save, user } = await harness();
    const response = await request();
    expect(response.status).toBe(201);
    expect(save).toHaveBeenCalledWith(user.id, "2026-10", "Task,Status\r\nTest,Completed");
    expect(await response.json()).toMatchObject({ filename: "moc-report-2026-10.csv" });
  });
  it.each(["anonymous", "member"] as const)("rejects %s export access before storage work", async (role) => {
    const { request, save } = await harness(role);
    expect((await request()).status).toBe(role === "anonymous" ? 401 : 403);
    expect(save).not.toHaveBeenCalled();
  });
  it("rejects invalid months and oversized reports", async () => {
    const { request, save } = await harness();
    expect((await request({ month: "2026-13", csv: "data" })).status).toBe(400);
    expect((await request({ month: "2026-10", csv: "x".repeat(60_001) })).status).toBe(400);
    expect(save).not.toHaveBeenCalled();
  });
  it("never advertises or issues demo sessions with a managed identity resolver", async () => {
    const { app } = await harness("anonymous");
    expect(await (await app.request("/api/session")).json()).toEqual({ user: null, demo: false });
    const response = await app.request("/api/auth/demo", { method: "POST", headers: { origin: "http://localhost:5173", "content-type": "application/json" }, body: JSON.stringify({ department: "cell-0" }) });
    expect(response.status).toBe(403);
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});


describe("private report download API", () => {
  const id = "840d43c6-e0ef-488b-912a-9dd27794d25f";
  it("authorizes each download and serves bytes through the API with no public storage URL", async () => {
    const { app } = await harness();
    const response = await app.request(`/api/reports/${id}/download`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("content-disposition")).toContain("attachment");
    expect(await response.text()).toBe("Task,Status\r\nTest,Completed");
  });
  it.each(["anonymous", "member"] as const)("rejects %s downloads", async (role) => {
    const { app } = await harness(role);
    expect((await app.request(`/api/reports/${id}/download`)).status).toBe(role === "anonymous" ? 401 : 403);
  });
});

describe("Supabase report storage adapter", () => {
  it("uploads privately, records metadata, and returns an API URL", async () => {
    const { SupabaseReportStorage } = await import("./report-storage");
    const upload = vi.fn().mockResolvedValue({ error: null });
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const { storage, from } = storageFixture({ upload });
    const adapter = new SupabaseReportStorage({ query } as never, storage, "workspace", "private-reports");
    const saved = await adapter.save("member", "2026-11", "Task,Status");
    expect(from).toHaveBeenCalledWith("private-reports");
    expect(upload).toHaveBeenCalledWith(expect.stringMatching(/^reports\/workspace\//), expect.any(Buffer), { contentType: "text/csv; charset=utf-8", upsert: false });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO moc.report_exports"), [saved.id, "workspace", "member", expect.any(String), "moc-report-2026-11.csv"]);
    expect(saved.url).toBe(`/api/reports/${saved.id}/download`);
  });
  it("removes an orphan upload if metadata fails, without publishing a download URL", async () => {
    const { SupabaseReportStorage } = await import("./report-storage");
    const upload = vi.fn().mockResolvedValue({ error: null });
    const remove = vi.fn().mockResolvedValue({ error: null });
    const { storage } = storageFixture({ upload, remove });
    const adapter = new SupabaseReportStorage({ query: vi.fn().mockRejectedValue(new Error("database unavailable")) } as never, storage);
    await expect(adapter.save("member", "2026-11", "csv")).rejects.toThrow("database unavailable");
    expect(remove).toHaveBeenCalledWith([expect.stringMatching(/^reports\/moc\//)]);
  });
  it("resolves a saved key only within its workspace before retrieving bytes", async () => {
    const { SupabaseReportStorage } = await import("./report-storage");
    const download = vi.fn().mockResolvedValue({ data: new Blob(["csv"]), error: null });
    const { storage } = storageFixture({ download });
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ object_key: "stored/key", filename: "report.csv" }] }).mockResolvedValueOnce({ rows: [] });
    const adapter = new SupabaseReportStorage({ query } as never, storage, "workspace");
    expect((await adapter.download("export"))?.filename).toBe("report.csv");
    expect(query).toHaveBeenCalledWith(expect.stringContaining("workspace_id = $2"), ["export", "workspace"]);
    expect(download).toHaveBeenCalledWith("stored/key");
    expect(await adapter.download("unknown")).toBeNull();
    expect(download).toHaveBeenCalledTimes(1);
  });
});
function storageFixture(methods: Record<string, unknown>) {
  const from = vi.fn().mockReturnValue(methods);
  return { storage: { storage: { from } } as unknown as import("@supabase/supabase-js").SupabaseClient, from };
}
