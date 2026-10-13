import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createSeedState, type Leader, type WorkspaceState } from "@moc/shared";

export interface Repository {
  read(): Promise<WorkspaceState>;
  update(
    mutator: (state: WorkspaceState) => WorkspaceState,
  ): Promise<WorkspaceState>;
  findApprovedLeaderByGoogleEmail(email: string): Promise<Leader | null>;
  getDemoLeaderByDepartment(department: Leader["department"]): Leader | null;
}

const initialState = (): WorkspaceState => createSeedState();

function parseState(source: string): WorkspaceState {
  const value: unknown = JSON.parse(source);
  if (typeof value !== "object" || value === null)
    throw new Error("Workspace state must be an object");
  const candidate = value as Partial<WorkspaceState>;
  if (
    !Array.isArray(candidate.tasks) ||
    !Array.isArray(candidate.requests) ||
    !Array.isArray(candidate.users) ||
    !Array.isArray(candidate.activities) ||
    !Array.isArray(candidate.notifications)
  ) {
    throw new Error("Workspace state is missing required collections");
  }
  return candidate as WorkspaceState;
}

/** Local JSON adapter. Replace this implementation with a durable repository for production. */
export class JsonRepository implements Repository {
  private pending: Promise<void> = Promise.resolve();
  private initialization: Promise<WorkspaceState> | undefined;
  private readonly filePath: string;

  constructor(
    filePath: string,
    private readonly seed: () => WorkspaceState = initialState,
  ) {
    this.filePath = resolve(filePath);
  }

  async read(): Promise<WorkspaceState> {
    try {
      return parseState(await readFile(this.filePath, "utf8"));
    } catch (error) {
      if (isMissingFile(error)) {
        const initial = this.seed();
        this.initialization ??= this.write(initial).then(() => initial);
        return await this.initialization;
      }
      throw error;
    }
  }

  async update(
    mutator: (state: WorkspaceState) => WorkspaceState,
  ): Promise<WorkspaceState> {
    let release: (() => void) | undefined;
    const previous = this.pending;
    this.pending = new Promise<void>((resolvePromise) => {
      release = resolvePromise;
    });
    await previous;
    try {
      const next = mutator(await this.read());
      await this.write(next);
      return next;
    } finally {
      release?.();
    }
  }

  async findApprovedLeaderByGoogleEmail(email: string): Promise<Leader | null> {
    const normalized = email.trim().toLowerCase();
    return (
      (await this.read()).users.find(
        (user) => user.approved && user.email.toLowerCase() === normalized,
      ) ?? null
    );
  }

  getDemoLeaderByDepartment(department: Leader["department"]): Leader | null {
    return (
      this.seed().users.find(
        (user) => user.department === department && user.approved,
      ) ?? null
    );
  }

  private async write(state: WorkspaceState): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, this.filePath);
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
