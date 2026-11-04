import { Pool } from "pg";
import { databaseConnectionOptions } from "./database-config";
import { attachDatabasePool as attachVercelPool } from "@vercel/functions";

let pool: Pool | undefined;
export function databasePool(): Pool {
  if (!process.env.SUPABASE_DATABASE_URL) throw new Error("SUPABASE_DATABASE_URL is required.");
  if (!pool) {
    pool = new Pool({
      ...databaseConnectionOptions(process.env.SUPABASE_DATABASE_URL),
      max: 5,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: process.env.VERCEL ? 5_000 : 30_000,
    });
    if (process.env.VERCEL) attachVercelPool(pool);
  }
  return pool;
}
