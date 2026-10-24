import "./load-env";
import { createApiApp, type ApiOptions } from "./index";
import { databasePool } from "./postgres";
import { PostgresRepository } from "./postgres-repository";
import { neonSessionResolver } from "./neon-auth";
import { NeonReportStorage } from "./report-storage";
import { workspaceRealtime } from "./realtime";

export function createRuntimeApp(options: Pick<ApiOptions, "resolveRemoteAddress"> = {}) {
  if (!process.env.DATABASE_URL) {
    if (process.env.NODE_ENV === "production") throw new Error("Production requires DATABASE_URL.");
    return createApiApp(undefined, options);
  }
  const pool = databasePool();
  const repository = new PostgresRepository(pool);
  return createApiApp(repository, {
    ...options,
    resolveSession: neonSessionResolver(repository, pool),
    reportStorage: new NeonReportStorage(pool),
    storage: "neon-postgres",
    sealWorkspace: workspaceRealtime(),
  });
}
