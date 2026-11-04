import "../apps/api/src/load-env";
import { Client } from "pg";

// Read-only, aggregate metadata only. Never prints database credentials, member
// records, comments or SQL text, and never resets the diagnostic counters.
const client = new Client({
  connectionString: process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL,
  connectionTimeoutMillis: 10_000,
  application_name: "moc-egress-diagnostic",
});
if (!process.env.DATABASE_URL_UNPOOLED && !process.env.DATABASE_URL)
  throw new Error("Pull the existing Neon environment before running this diagnostic.");

try {
  await client.connect();
  await client.query("BEGIN READ ONLY");
  await client.query("SET LOCAL statement_timeout = '10s'");
  const sizes = await client.query(`SELECT id,
    octet_length(payload::text) AS workspace_text_bytes,
    octet_length((payload->'catalog')::text) AS catalog_text_bytes,
    jsonb_array_length(payload->'tasks') AS tasks,
    jsonb_array_length(payload->'requests') AS requests,
    jsonb_array_length(payload->'activities') AS activities
    FROM moc.workspace_state`);
  const available = await client.query("SELECT to_regclass('public.pg_stat_statements') IS NOT NULL AS available");
  let queries: unknown[] = [];
  if (available.rows[0]?.available) {
    const stats = await client.query(`SELECT queryid::text, calls::text, rows::text, round(total_exec_time::numeric, 2)::text AS execution_ms,
      CASE
        WHEN query ~* '^SELECT payload FROM moc.workspace_state.*FOR UPDATE' THEN 'full workspace read for save'
        WHEN query ~* '^SELECT payload FROM moc.workspace_state' THEN 'full workspace read'
        WHEN query ~* 'SELECT.*catalog.*FROM moc.workspace_state' AND query ~* 'jsonb_array_elements' THEN 'projected member lookup'
        WHEN query ~* 'SELECT.*catalog.*FROM moc.workspace_state' THEN 'projected catalog read'
        WHEN query ~* 'workspace_members' THEN 'membership / priority live query'
        WHEN query ~* 'neon_auth' THEN 'managed Auth'
        ELSE 'other (inspect queryid in Neon SQL editor)'
      END AS category
      FROM public.pg_stat_statements WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
      AND calls > 0 ORDER BY calls DESC LIMIT 30`);
    queries = stats.rows;
  }
  await client.query("ROLLBACK");
  console.log(JSON.stringify({
    measuredAt: new Date().toISOString(), sizes: sizes.rows, statisticsAvailable: Boolean(available.rows[0]?.available), queries,
    limits: "Current text sizes and surviving statement counts identify amplification; they do not reconstruct historical billed bytes. Counters can disappear after compute restarts. No counters were reset. No private data or SQL text is included.",
  }, null, 2));
} catch (error) {
  const message = error instanceof Error ? error.message : "Diagnostic failed";
  console.error(/quota/i.test(message)
    ? "Neon quota is still blocking SQL. Restore access before measuring query sources."
    : "Could not read diagnostic metadata. Check database availability and pg_stat_statements permissions.");
  process.exitCode = 1;
} finally {
  await client.end();
}
