import "./load-env";
import { createApiApp, type ApiOptions } from "./index";
import { databasePool } from "./postgres";
import { PostgresRepository } from "./postgres-repository";
import { createSupabaseAuthRouter, supabaseSessionResolver } from "./supabase-auth";
import { SupabaseReportStorage } from "./report-storage";
import { workspaceEvents } from "./realtime";
import { supabaseServiceClient } from "./supabase";

export function createRuntimeApp(options: Pick<ApiOptions, "resolveRemoteAddress"> = {}) {
  if (!process.env.SUPABASE_DATABASE_URL) {
    if (process.env.NODE_ENV === "production" || process.env.SUPABASE_URL)
      throw new Error("Set SUPABASE_DATABASE_URL on the API before using Supabase.");
    return createApiApp(undefined, options);
  }
  const pool = databasePool();
  const repository = new PostgresRepository(pool);
  const service = supabaseServiceClient();
  return createApiApp(repository, {
    ...options,
    resolveSession: supabaseSessionResolver(repository),
    authRouter: createSupabaseAuthRouter(repository),
    reportStorage: new SupabaseReportStorage(pool, service),
    storage: "supabase-postgres",
    workspaceEvents: workspaceEvents(pool, supabaseServiceClient),
  });
}
