import { Pool } from "pg";
import { attachDatabasePool as attachNeonPool } from "@neon/functions";
import { attachDatabasePool as attachVercelPool } from "@vercel/functions";

let pool: Pool | undefined;
export function databasePool(): Pool {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: process.env.VERCEL ? 5_000 : 30_000,
    });
    if (process.env.VERCEL) attachVercelPool(pool);
    else attachNeonPool(pool);
  }
  return pool;
}
