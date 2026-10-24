import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSeedState, currentBannerQuote, type WorkspaceAction, type WorkspaceState } from "@moc/shared";
import { createApiApp } from "./index";
import { JsonRepository } from "./repository";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

async function harness() {
  const directory = await mkdtemp(join(tmpdir(), "moc-banner-quotes-"));
  directories.push(directory);
  const file = join(directory, "state.json");
  const repository = new JsonRepository(file);
  let now = new Date("2026-10-24T08:00:00Z");
  let randomCalls = 0;
  const seed = createSeedState();
  const admin = seed.users.find((user) => user.department === "cell-0")!;
  const sound = seed.users.find((user) => user.department === "sound")!;
  const options = {
    now: () => now,
    quoteRandom: () => { randomCalls++; return 0; },
    resolveSession: async (context: { req: { header: (key: string) => string | undefined } }) => ({
      user: context.req.header("x-test-member") === "sound" ? sound : context.req.header("x-test-member") === "admin" ? admin : null,
      demo: false,
    }),
  };
  const app = createApiApp(repository, options);
  const workspace = async (member = "admin") => {
    const response = await app.request("/api/workspace", { headers: { "x-test-member": member } });
    expect(response.status).toBe(200);
    return await response.json() as WorkspaceState;
  };
  const action = (payload: WorkspaceAction, member = "admin") => app.request("/api/actions", {
    method: "POST", headers: { origin: "http://localhost:5173", "content-type": "application/json", "x-test-member": member }, body: JSON.stringify(payload),
  });
  return { app, repository, file, options, workspace, action, setDate: (date: string) => { now = new Date(date); }, getRandomCalls: () => randomCalls };
}

describe("banner quote API persistence", () => {
  it("shares one persisted random pick across concurrent members, reloads and API instances", async () => {
    const test = await harness();
    const [admin, sound] = await Promise.all([test.workspace(), test.workspace("sound")]);
    expect(currentBannerQuote(admin.bannerQuotes)).toEqual(currentBannerQuote(sound.bannerQuotes));
    expect(admin.bannerQuotes?.quotes).toHaveLength(1);
    expect(sound.bannerQuotes?.quotes).toEqual([]);
    expect(test.getRandomCalls()).toBe(1);
    const reloaded = createApiApp(new JsonRepository(test.file), test.options);
    const response = await reloaded.request("/api/workspace", { headers: { "x-test-member": "sound" } });
    expect(currentBannerQuote((await response.json() as WorkspaceState).bannerQuotes)).toEqual(currentBannerQuote(admin.bannerQuotes));
    expect(test.getRandomCalls()).toBe(1);
  });

  it("creates, edits, overrides, restores and bulk deletes, with rollover at Johannesburg midnight", async () => {
    const test = await harness();
    const original = currentBannerQuote((await test.workspace()).bannerQuotes)!;
    const created = await test.action({ type: "save-banner-quote", quote: { text: "Daily test quote", author: "Test person" } });
    expect(created.status).toBe(200);
    const quote = (await created.json() as WorkspaceState).bannerQuotes!.quotes.find((item) => item.id !== original.id)!;
    expect((await test.action({ type: "set-banner-quote-today", quoteId: quote.id })).status).toBe(200);
    expect(currentBannerQuote((await test.workspace("sound")).bannerQuotes)).toEqual(quote);
    expect((await test.action({ type: "save-banner-quote", quote: { ...quote, text: "Edited for tomorrow" } })).status).toBe(200);
    expect(currentBannerQuote((await test.workspace()).bannerQuotes)).toEqual(quote);
    expect((await test.action({ type: "reset-banner-quote-today" })).status).toBe(200);
    expect(currentBannerQuote((await test.workspace()).bannerQuotes)).toEqual(original);
    await test.action({ type: "set-banner-quote-today", quoteId: quote.id });
    test.setDate("2026-10-24T21:59:59.999Z");
    expect(currentBannerQuote((await test.workspace()).bannerQuotes)?.text).toBe("Edited for tomorrow");
    test.setDate("2026-10-24T22:00:00Z");
    const next = await test.workspace("sound");
    expect(next.bannerQuotes?.daily?.date).toBe("2026-10-25");
    expect(next.bannerQuotes?.daily?.override).toBeUndefined();
    expect(currentBannerQuote(next.bannerQuotes)).toEqual(original);
    expect((await test.action({ type: "delete-banner-quotes", quoteIds: [original.id, quote.id] })).status).toBe(200);
    expect((await new JsonRepository(test.file).read()).bannerQuotes?.quotes).toEqual([]);
    test.setDate("2026-10-25T22:00:00Z");
    expect(currentBannerQuote((await test.workspace()).bannerQuotes)).toBeNull();
  });

  it("rejects unauthorized writes, invalid quotes and stale bulk deletes without changing persisted settings", async () => {
    const test = await harness();
    expect((await test.app.request("/api/workspace")).status).toBe(401);
    const before = (await test.workspace()).bannerQuotes;
    expect((await test.action({ type: "save-banner-quote", quote: { text: "No access", author: "Person" } }, "sound")).status).toBe(400);
    expect((await test.action({ type: "save-banner-quote", quote: { text: " ", author: "Person" } })).status).toBe(400);
    expect((await test.action({ type: "delete-banner-quotes", quoteIds: [before!.quotes[0].id, "stale"] })).status).toBe(400);
    expect((await test.repository.read()).bannerQuotes).toEqual(before);
  });
});
