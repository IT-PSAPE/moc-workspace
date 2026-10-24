import type { Pool } from "pg";
import { createSeedState, type Leader, type WorkspaceState } from "@moc/shared";
import { parseState, type Repository } from "./repository";

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
      await client.query(`INSERT INTO moc.workspace_members (workspace_id, member_id, approved)
        SELECT $1, member->>'id', (member->>'approved')::boolean
        FROM jsonb_array_elements($2::jsonb) AS member
        ON CONFLICT (workspace_id, member_id) DO UPDATE SET approved = EXCLUDED.approved`, [this.workspaceId, JSON.stringify(next.users)]);
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

  async findApprovedLeaderByGoogleEmail(email: string): Promise<Leader | null> {
    return (await this.read()).users.find((user) => user.approved && user.email.toLowerCase() === email.trim().toLowerCase()) ?? null;
  }

  getDemoLeaderByDepartment(): null { return null; }
}
