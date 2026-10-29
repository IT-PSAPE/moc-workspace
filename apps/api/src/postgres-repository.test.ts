import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { createSeedState } from "@moc/shared";
import { PostgresRepository } from "./postgres-repository";

const state = createSeedState();
function harness(rows: unknown[]) {
  const query = vi.fn().mockResolvedValue({ rows });
  return { query, repository: new PostgresRepository({ query } as unknown as Pool, "test-workspace") };
}

describe("Postgres read projections", () => {
  it("returns the catalog without transferring private workspace collections", async () => {
    const { query, repository } = harness([{ catalog: state.catalog }]);
    expect(await repository.readCatalog()).toEqual(state.catalog);
    const [sql, parameters] = query.mock.calls[0]!;
    expect(sql).toContain("SELECT payload -> 'catalog' AS catalog");
    expect(parameters).toEqual(["test-workspace"]);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("returns a normalized member using a bounded projection and a parameterized email", async () => {
    const member = state.users.find((user) => user.approved)!;
    const { query, repository } = harness([{ catalog: state.catalog, member }]);
    expect(await repository.findApprovedLeaderByGoogleEmail(` ${member.email.toUpperCase()} `)).toEqual(member);
    const [sql, parameters] = query.mock.calls[0]!;
    expect(sql).toContain("SELECT state.payload -> 'catalog' AS catalog, member");
    expect(sql).toContain("member -> 'approved' = 'true'::jsonb");
    expect(sql).toContain("lower(member ->> 'email') = $2");
    expect(sql).toContain("LIMIT 1");
    expect(parameters).toEqual(["test-workspace", member.email.toLowerCase()]);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("preserves legacy member migration in the smaller projection", async () => {
    const member = state.users.find((user) => user.approved)!;
    const { duty, groups: _groups, isLeader: _isLeader, ...legacy } = member;
    const { repository } = harness([{ catalog: state.catalog, member: { ...legacy, rank: duty } }]);
    expect(await repository.findApprovedLeaderById(member.id)).toEqual({
      ...member,
      groups: state.catalog.departments.find((department) => department.id === member.department)!.groups,
      isLeader: true,
    });
  });

  it("does not grant access when the approved-member query returns no match", async () => {
    const { repository, query } = harness([]);
    expect(await repository.findApprovedLeaderById("removed-member")).toBeNull();
    expect(await repository.findApprovedLeaderByGoogleEmail("uninvited@example.com")).toBeNull();
    expect(query).toHaveBeenLastCalledWith(expect.stringContaining("member -> 'approved' = 'true'::jsonb"), ["test-workspace", "uninvited@example.com"]);
  });

  it("continues to reject malformed member data", async () => {
    const member = { ...state.users[0], groups: ["unrecognized-group"] };
    const { repository } = harness([{ catalog: state.catalog, member }]);
    await expect(repository.findApprovedLeaderById(member.id!)).rejects.toThrow(/groups do not match/);
  });

  it("keeps missing and legacy catalog behavior", async () => {
    const { repository } = harness([]);
    await expect(repository.readCatalog()).rejects.toThrow(/not initialized/);
    const legacy = { ...state, catalog: undefined };
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ catalog: null }] }).mockResolvedValueOnce({ rows: [{ payload: legacy }] });
    const projected = new PostgresRepository({ query } as unknown as Pool);
    expect((await projected.readCatalog()).departments).toHaveLength(state.catalog.departments.length);
  });
});
