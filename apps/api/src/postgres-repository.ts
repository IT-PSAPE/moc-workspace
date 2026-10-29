import type { Pool } from "pg";
import { createSeedState, type Catalog, type Leader, type WorkspaceState } from "@moc/shared";
import { parseCatalog, parseMember, parseState, type Repository } from "./repository";

export function emptyWorkspace(): WorkspaceState {
  return { catalog: createSeedState().catalog, tasks: [], requests: [], users: [], activities: [], notifications: [] };
}

/** Keep the existing aggregate contract; a row lock serializes every domain mutation. */
export class PostgresRepository implements Repository {
  constructor(
    private readonly pool: Pool,
    private readonly workspaceId = "moc",
  ) {}

  async initialize(seed: WorkspaceState = emptyWorkspace()): Promise<void> {
    await this.pool.query(
      "INSERT INTO moc.workspace_state (id, payload) VALUES ($1, $2::jsonb) ON CONFLICT (id) DO NOTHING",
      [this.workspaceId, JSON.stringify(parseState(JSON.stringify(seed)))],
    );
    await this.update((state) => state);
  }

  async read(): Promise<WorkspaceState> {
    const result = await this.pool.query("SELECT payload FROM moc.workspace_state WHERE id = $1", [this.workspaceId]);
    if (!result.rows[0]) throw new Error("Workspace is not initialized. Run npm run db:migrate.");
    return parseState(JSON.stringify(result.rows[0].payload));
  }

  async update(mutator: (state: WorkspaceState) => WorkspaceState): Promise<WorkspaceState> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query("SELECT payload FROM moc.workspace_state WHERE id = $1 FOR UPDATE", [this.workspaceId]);
      if (!result.rows[0]) throw new Error("Workspace is not initialized.");
      const next = parseState(JSON.stringify(mutator(parseState(JSON.stringify(result.rows[0].payload)))));
      await client.query("UPDATE moc.workspace_state SET payload = $2::jsonb, updated_at = now(), revision = revision + 1 WHERE id = $1", [this.workspaceId, JSON.stringify(next)]);
      await client.query(`INSERT INTO moc.workspace_members AS existing (workspace_id, member_id, approved)
        SELECT $1, member->>'id', (member->>'approved')::boolean
        FROM jsonb_array_elements($2::jsonb) AS member
        ON CONFLICT (workspace_id, member_id) DO UPDATE SET approved = EXCLUDED.approved
        WHERE existing.approved IS DISTINCT FROM EXCLUDED.approved`, [this.workspaceId, JSON.stringify(next.users)]);
      await client.query("DELETE FROM moc.workspace_members WHERE workspace_id = $1 AND NOT (member_id = ANY($2::text[]))", [this.workspaceId, next.users.map((user) => user.id)]);
      await client.query("COMMIT");
      return next;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async readCatalog(): Promise<Catalog> {
    const result = await this.pool.query("SELECT payload -> 'catalog' AS catalog FROM moc.workspace_state WHERE id = $1", [this.workspaceId]);
    if (!result.rows[0]) throw new Error("Workspace is not initialized. Run npm run db:migrate.");
    // Preserve legacy catalog migration for stores that predate an explicit catalog.
    return result.rows[0].catalog === null
      ? (await this.read()).catalog
      : parseCatalog(result.rows[0].catalog);
  }

  async findApprovedLeaderById(id: string): Promise<Leader | null> {
    return this.findApprovedMember("member ->> 'id' = $2", id);
  }

  async findApprovedLeaderByGoogleEmail(email: string): Promise<Leader | null> {
    return this.findApprovedMember("lower(member ->> 'email') = $2", email.trim().toLowerCase());
  }

  private async findApprovedMember(predicate: string, value: string): Promise<Leader | null> {
    const result = await this.pool.query(
      `SELECT state.payload -> 'catalog' AS catalog, member
       FROM moc.workspace_state AS state,
            LATERAL jsonb_array_elements(state.payload -> 'users') AS member
       WHERE state.id = $1 AND member -> 'approved' = 'true'::jsonb
         AND ${predicate}
       LIMIT 1`,
      [this.workspaceId, value],
    );
    const row = result.rows[0];
    if (!row) return null;
    const catalog = row.catalog === null ? (await this.read()).catalog : parseCatalog(row.catalog);
    return parseMember(row.member, catalog);
  }

  getDemoLeaderByDepartment(): null { return null; }
}
