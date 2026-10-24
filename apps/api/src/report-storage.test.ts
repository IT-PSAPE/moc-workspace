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
  const save = vi.fn().mockResolvedValue({ id: "export", filename: "moc-report-2026-10.csv", url: "https://private-storage.invalid/signed" });
  const app = createApiApp(repository, { resolveSession: async () => ({ user: role === "anonymous" ? null : user, demo: false }), reportStorage: { save }, storage: "neon-postgres" });
  const request = (body: unknown = { month: "2026-10", csv: "Task,Status\r\nTest,Completed" }) => app.request("/api/reports/export", { method: "POST", headers: { origin: "http://localhost:5173", "content-type": "application/json" }, body: JSON.stringify(body) });
  return { app, request, save, user };
}

describe("private report exports", () => {
  it("stores an approved Cell 0 leader's report and returns a signed download", async () => {
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
