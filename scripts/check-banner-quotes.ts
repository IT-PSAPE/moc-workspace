import "../apps/api/src/load-env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { createSeedState, currentBannerQuote, type WorkspaceState, type WorkspaceAction } from "@moc/shared";
import { createApiApp } from "../apps/api/src/index";
import { PostgresRepository } from "../apps/api/src/postgres-repository";

// Exercise actual Neon persistence in a unique aggregate, leaving workspace data alone.
assert(process.env.DATABASE_URL, "DATABASE_URL is required for this integration check.");
const workspaceId = `quote-check-${randomUUID()}`;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5, connectionTimeoutMillis: 10_000 });
const repository = new PostgresRepository(pool, workspaceId);
let clock = new Date("2026-10-24T21:59:59Z");
let picks = 0;
const seed = createSeedState();
seed.tasks = []; seed.requests = []; seed.activities = []; seed.notifications = [];
seed.bannerQuotes = { quotes: [
  { id: "quote-first", text: "Shared daily quote", author: "Quote check" },
  { id: "quote-second", text: "Today only", author: "Quote check" },
] };
const admin = seed.users.find((user) => user.department === "cell-0")!;
const member = seed.users.find((user) => user.department === "sound")!;
const options: Parameters<typeof createApiApp>[1] = {
  now: () => clock,
  quoteRandom: () => { picks++; return 0; },
  resolveSession: async (context) => ({ user: context.req.header("x-quote-test-role") === "member" ? member : admin, demo: false }),
};
const app = createApiApp(repository, options);
const secondApp = createApiApp(new PostgresRepository(pool, workspaceId), options);
async function workspace(target = app, role = "admin") {
  const response = await target.request("/api/workspace", { headers: { "x-quote-test-role": role } });
  assert.equal(response.status, 200);
  return await response.json() as WorkspaceState;
}
async function action(value: WorkspaceAction) {
  const response = await app.request("/api/actions", {
    method: "POST", headers: { origin: "http://localhost:5173", "content-type": "application/json" }, body: JSON.stringify(value),
  });
  assert.equal(response.status, 200, await response.text());
}
try {
  await repository.initialize(seed);
  const results = await Promise.all(Array.from({ length: 8 }, (_, index) => workspace(index % 2 ? secondApp : app, index % 2 ? "member" : "admin")));
  assert.equal(picks, 1);
  assert(results.every((state) => currentBannerQuote(state.bannerQuotes)?.id === "quote-first"));
  assert.equal(results[1].bannerQuotes!.quotes.length, 0);
  console.log("PASS Neon: eight concurrent reads across two API instances share one persisted pick; members receive the banner without the management library");
  await action({ type: "set-banner-quote-today", quoteId: "quote-second" });
  assert.equal(currentBannerQuote((await workspace(secondApp, "member")).bannerQuotes)?.id, "quote-second");
  await action({ type: "save-banner-quote", quote: { id: "quote-second", text: "Edited for future picks", author: "Quote check" } });
  assert.equal(currentBannerQuote((await workspace()).bannerQuotes)?.text, "Today only");
  await action({ type: "reset-banner-quote-today" });
  assert.equal(currentBannerQuote((await workspace()).bannerQuotes)?.id, "quote-first");
  await action({ type: "set-banner-quote-today", quoteId: "quote-second" });
  const stored = await new PostgresRepository(pool, workspaceId).read();
  assert.equal(currentBannerQuote(stored.bannerQuotes)?.text, "Edited for future picks");
  console.log("PASS Neon: create/edit persistence, shared override, stable snapshots and restoration through a fresh repository instance");
  clock = new Date("2026-10-24T22:00:00Z");
  const next = await workspace(secondApp, "member");
  assert.equal(next.bannerQuotes?.daily?.date, "2026-10-25");
  assert.equal(next.bannerQuotes?.daily?.override, undefined);
  assert.equal(currentBannerQuote(next.bannerQuotes)?.id, "quote-first");
  await action({ type: "delete-banner-quotes", quoteIds: ["quote-first", "quote-second"] });
  assert.deepEqual((await repository.read()).bannerQuotes?.quotes, []);
  assert.equal(currentBannerQuote((await workspace()).bannerQuotes)?.id, "quote-first");
  clock = new Date("2026-10-25T22:00:00Z");
  assert.equal(currentBannerQuote((await workspace()).bannerQuotes), null);
  console.log("PASS Neon: Johannesburg midnight clears the override, bulk deletion persists, and an empty library hides the following day's banner");
} finally {
  await pool.query("DELETE FROM moc.workspace_state WHERE id = $1", [workspaceId]);
  await pool.end();
}
