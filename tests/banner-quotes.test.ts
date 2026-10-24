import { describe, expect, it } from "vitest";
import {
  applyAction, bannerQuoteDate, createSeedState, currentBannerQuote, defaultBannerQuotes,
  ensureDailyBannerQuote, millisecondsUntilNextQuoteDay, parseBannerQuotes, validateWorkspaceAction,
  type WorkspaceAction, type WorkspaceState,
} from "../packages/shared/src";

const morning = new Date("2026-10-24T08:00:00Z");
function fixture(): WorkspaceState {
  return { ...createSeedState(), bannerQuotes: { quotes: [
    { id: "quote-one", text: "First quote", author: "First person" },
    { id: "quote-two", text: "Second quote", author: "Second person" },
  ] } };
}
const admin = (state: WorkspaceState) => state.users.find((user) => user.department === "cell-0")!;

describe("daily banner quotes", () => {
  it("uses Johannesburg midnight rather than the server or browser's calendar day", () => {
    expect(bannerQuoteDate(new Date("2026-10-24T21:59:59.999Z"))).toBe("2026-10-24");
    expect(millisecondsUntilNextQuoteDay(new Date("2026-10-24T21:59:59.999Z"))).toBe(1);
    expect(bannerQuoteDate(new Date("2026-10-24T22:00:00Z"))).toBe("2026-10-25");
    expect(millisecondsUntilNextQuoteDay(new Date("2026-10-24T22:00:00Z"))).toBe(86_400_000);
    expect(bannerQuoteDate(new Date("2026-12-31T22:00:00Z"))).toBe("2027-01-01");
  });

  it("selects from the whole library once per day, without rerandomizing on reads", () => {
    const original = fixture();
    const first = ensureDailyBannerQuote(original, morning, () => 0.99);
    expect(currentBannerQuote(first.bannerQuotes)?.id).toBe("quote-two");
    expect(ensureDailyBannerQuote(first, new Date("2026-10-24T21:59:59Z"), () => { throw new Error("Must not reroll"); })).toBe(first);
    const next = ensureDailyBannerQuote(first, new Date("2026-10-24T22:00:00Z"), () => 0);
    expect(currentBannerQuote(next.bannerQuotes)?.id).toBe("quote-one");
    expect(original.bannerQuotes?.daily).toBeUndefined();
  });

  it("overrides today only, restores the original pick, and clears overrides the next day", () => {
    const selected = ensureDailyBannerQuote(fixture(), morning, () => 0);
    const overridden = applyAction(selected, admin(selected), { type: "set-banner-quote-today", quoteId: "quote-two" }, morning);
    expect(currentBannerQuote(overridden.bannerQuotes)?.id).toBe("quote-two");
    const restored = applyAction(overridden, admin(overridden), { type: "reset-banner-quote-today" }, morning);
    expect(currentBannerQuote(restored.bannerQuotes)?.id).toBe("quote-one");
    expect(restored.bannerQuotes?.daily?.override).toBeUndefined();
    const next = ensureDailyBannerQuote(overridden, new Date("2026-10-25T09:00:00Z"), () => 0);
    expect(currentBannerQuote(next.bannerQuotes)?.id).toBe("quote-one");
    expect(next.bannerQuotes?.daily?.override).toBeUndefined();
  });

  it("preserves today's snapshot through edits and deletion, including a deleted override", () => {
    const selected = ensureDailyBannerQuote(fixture(), morning, () => 0);
    const edited = applyAction(selected, admin(selected), { type: "save-banner-quote", quote: { id: "quote-one", text: "Edited quote", author: "Edited person" } }, morning);
    expect(currentBannerQuote(edited.bannerQuotes)?.text).toBe("First quote");
    const deleted = applyAction(edited, admin(edited), { type: "delete-banner-quotes", quoteIds: ["quote-one"] }, morning);
    expect(currentBannerQuote(deleted.bannerQuotes)?.text).toBe("First quote");
    expect(parseBannerQuotes(deleted.bannerQuotes)).toEqual(deleted.bannerQuotes);
    expect(currentBannerQuote(ensureDailyBannerQuote(deleted, new Date("2026-10-25T12:00:00Z")).bannerQuotes)?.id).toBe("quote-two");
  });

  it("handles an empty library and the first quote created after an empty daily pick", () => {
    const empty = ensureDailyBannerQuote({ ...fixture(), bannerQuotes: { quotes: [] } }, morning);
    expect(currentBannerQuote(empty.bannerQuotes)).toBeNull();
    expect(ensureDailyBannerQuote(empty, morning)).toBe(empty);
    const added = applyAction(empty, admin(empty), { type: "save-banner-quote", quote: { text: " Welcome ", author: " Someone " } }, morning);
    const filled = ensureDailyBannerQuote(added, morning);
    expect(currentBannerQuote(filled.bannerQuotes)).toMatchObject({ text: "Welcome", author: "Someone" });
    expect(ensureDailyBannerQuote(filled, morning)).toBe(filled);
  });

  it("rejects invalid text, stale IDs, duplicate selections and atomic partial deletes", () => {
    const state = fixture();
    for (const quote of [{ text: " ", author: "A" }, { text: "A", author: "" }, { text: "a".repeat(1001), author: "A" }, { text: "A", author: "a".repeat(161) }, null])
      expect(() => validateWorkspaceAction({ type: "save-banner-quote", quote })).toThrow();
    expect(() => applyAction(state, admin(state), { type: "save-banner-quote", quote: { id: "missing", text: "A", author: "B" } })).toThrow(/not found/);
    expect(() => applyAction(state, admin(state), { type: "delete-banner-quotes", quoteIds: ["quote-one", "missing"] })).toThrow(/not found/);
    expect(state.bannerQuotes?.quotes).toHaveLength(2);
    expect(() => validateWorkspaceAction({ type: "delete-banner-quotes", quoteIds: ["quote-one", "quote-one"] })).toThrow(/only once/);
    expect(() => applyAction(state, admin(state), { type: "set-banner-quote-today", quoteId: "missing" })).toThrow(/not found/);
  });

  it("restricts every management action to approved Cell 0 leaders", () => {
    const state = fixture();
    const actions: WorkspaceAction[] = [
      { type: "save-banner-quote", quote: { text: "A", author: "B" } },
      { type: "delete-banner-quotes", quoteIds: ["quote-one"] },
      { type: "set-banner-quote-today", quoteId: "quote-one" },
      { type: "reset-banner-quote-today" },
    ];
    const sound = state.users.find((user) => user.department === "sound")!;
    const nonLeader = { ...admin(state), isLeader: false };
    const withMember = { ...state, users: state.users.map((user) => user.id === nonLeader.id ? nonLeader : user) };
    for (const action of actions) {
      expect(() => applyAction(state, sound, action)).toThrow(/Cell 0 leader/);
      expect(() => applyAction(withMember, nonLeader, action)).toThrow(/Cell 0 leader/);
      expect(() => applyAction(state, { ...admin(state), approved: false }, action)).toThrow(/not been approved/);
    }
  });

  it("seeds legacy workspaces but preserves intentionally empty libraries", () => {
    expect(parseBannerQuotes(undefined)).toEqual(defaultBannerQuotes());
    expect(parseBannerQuotes({ quotes: [] })).toEqual({ quotes: [] });
    expect(() => parseBannerQuotes({ quotes: [fixture().bannerQuotes!.quotes[0], fixture().bannerQuotes!.quotes[0]] })).toThrow(/unique/);
  });
});
