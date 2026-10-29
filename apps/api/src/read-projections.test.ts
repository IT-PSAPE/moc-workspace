import { describe, expect, it, vi } from "vitest";
import { createSeedState } from "@moc/shared";
import type { SealedLiveQuery } from "@neon/realtime/client";
import type { WorkspaceRevision } from "./realtime";
import { createApiApp } from "./index";
import type { Repository } from "./repository";

function harness() {
  const state = createSeedState();
  const member = state.users.find((user) => user.department === "cell-0" && user.approved && user.isLeader)!;
  const repository: Repository = {
    read: vi.fn().mockRejectedValue(new Error("This endpoint must not read the full workspace")),
    update: vi.fn().mockRejectedValue(new Error("This endpoint must not write workspace data")),
    readCatalog: vi.fn().mockResolvedValue(state.catalog),
    findApprovedLeaderById: vi.fn().mockResolvedValue(member),
    findApprovedLeaderByGoogleEmail: vi.fn().mockResolvedValue(member),
    getDemoLeaderByDepartment: () => null,
  };
  const app = createApiApp(repository, {
    resolveSession: async () => ({ user: member, demo: false }),
    sealWorkspace: async () => ({ capability: "test-capability" }) as unknown as SealedLiveQuery<WorkspaceRevision>,
  });
  return { app, repository, member, state };
}

describe("API read projections", () => {
  it("serves only the public catalog without reading private workspace data", async () => {
    const { app, state, repository } = harness();
    const response = await app.request("/api/catalog");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ...state.catalog, disabledMinistries: state.catalog.disabledMinistries ?? [] });
    expect(repository.read).not.toHaveBeenCalled();
    expect(repository.findApprovedLeaderById).not.toHaveBeenCalled();
  });

  it.each(["/api/session", "/api/integrations", "/api/workspace/live"])("uses current membership for %s without loading all tasks and requests", async (path) => {
    const { app, repository, member } = harness();
    const response = await app.request(path, {
      method: path.endsWith("/live") ? "POST" : "GET",
      headers: { origin: "http://localhost:5173" },
    });
    expect(response.status).toBe(200);
    expect(repository.findApprovedLeaderById).toHaveBeenCalledWith(member.id);
    expect(repository.read).not.toHaveBeenCalled();
  });

  it("denies revoked and demoted members even when the incoming session contains their old role", async () => {
    const { app, repository, member } = harness();
    vi.mocked(repository.findApprovedLeaderById).mockResolvedValue({ ...member, isLeader: false });
    expect((await app.request("/api/integrations")).status).toBe(403);
    vi.mocked(repository.findApprovedLeaderById).mockResolvedValue(null);
    expect(await (await app.request("/api/session")).json()).toEqual({ user: null, demo: false });
    expect((await app.request("/api/integrations")).status).toBe(401);
    expect((await app.request("/api/workspace/live", { method: "POST", headers: { origin: "http://localhost:5173" } })).status).toBe(401);
    expect(repository.read).not.toHaveBeenCalled();
  });
});
