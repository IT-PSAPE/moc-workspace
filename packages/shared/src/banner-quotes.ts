import type { BannerQuote, BannerQuoteSettings, WorkspaceState } from "./types";

export const BANNER_QUOTE_TIME_ZONE = "Africa/Johannesburg";
export const BANNER_QUOTE_MAX_LENGTH = 1000;
export const BANNER_QUOTE_AUTHOR_MAX_LENGTH = 160;

export function defaultBannerQuotes(): BannerQuoteSettings {
  return { quotes: [{
    id: "quote-workspace-default",
    text: "Fulfil your duty with faith and excellence.",
    author: "Chairman Man-Hee Lee",
  }] };
}

export function bannerQuoteDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BANNER_QUOTE_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  return ["year", "month", "day"].map((part) => parts.find((item) => item.type === part)!.value).join("-");
}

/** Johannesburg uses UTC+02:00 all year. */
export function millisecondsUntilNextQuoteDay(now = new Date()): number {
  const midnight = Date.parse(`${bannerQuoteDate(now)}T00:00:00+02:00`);
  return Math.max(1, midnight + 86_400_000 - now.getTime());
}

export function currentBannerQuote(settings: BannerQuoteSettings | undefined): BannerQuote | null {
  return settings?.daily?.override ?? settings?.daily?.selected ?? null;
}

/** Call under the repository lock; all readers share the persisted daily pick. */
export function ensureDailyBannerQuote(
  state: WorkspaceState,
  now = new Date(),
  random: () => number = Math.random,
): WorkspaceState {
  const settings = state.bannerQuotes ?? defaultBannerQuotes();
  const date = bannerQuoteDate(now);
  if (settings.daily?.date === date &&
    (currentBannerQuote(settings) || settings.quotes.length === 0)) return state;
  const selected = settings.quotes.length
    ? { ...settings.quotes[Math.min(settings.quotes.length - 1, Math.floor(random() * settings.quotes.length))] }
    : null;
  return { ...state, bannerQuotes: { quotes: settings.quotes, daily: { date, selected } } };
}

export function validateBannerQuote(value: unknown): asserts value is Omit<BannerQuote, "id"> & { id?: string } {
  if (!isRecord(value)) throw new Error("Quote details are required.");
  if (value.id !== undefined && (typeof value.id !== "string" || !value.id.trim() || value.id.length > 100))
    throw new Error("Choose a valid quote.");
  if (typeof value.text !== "string" || !value.text.trim() || value.text.length > BANNER_QUOTE_MAX_LENGTH)
    throw new Error(`Enter a quote between 1 and ${BANNER_QUOTE_MAX_LENGTH} characters.`);
  if (typeof value.author !== "string" || !value.author.trim() || value.author.length > BANNER_QUOTE_AUTHOR_MAX_LENGTH)
    throw new Error(`Enter an attribution between 1 and ${BANNER_QUOTE_AUTHOR_MAX_LENGTH} characters.`);
}

/** Validate both the library and snapshots, including references to deleted quotes. */
export function parseBannerQuotes(value: unknown): BannerQuoteSettings {
  if (value === undefined) return defaultBannerQuotes();
  if (!isRecord(value) || !Array.isArray(value.quotes)) throw new Error("Workspace banner quotes are malformed.");
  const quote = (item: unknown): BannerQuote => {
    validateBannerQuote(item);
    if (!item.id) throw new Error("Workspace quote ID is missing.");
    return { id: item.id, text: item.text.trim(), author: item.author.trim() };
  };
  const quotes = value.quotes.map(quote);
  if (new Set(quotes.map((item) => item.id)).size !== quotes.length)
    throw new Error("Workspace quote IDs must be unique.");
  if (value.daily === undefined) return { quotes };
  const daily = value.daily;
  if (!isRecord(daily) || typeof daily.date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(daily.date) || !Number.isFinite(Date.parse(`${daily.date}T00:00:00Z`)) ||
    new Date(`${daily.date}T00:00:00Z`).toISOString().slice(0, 10) !== daily.date)
    throw new Error("Workspace daily quote is malformed.");
  return { quotes, daily: {
    date: daily.date,
    selected: daily.selected === null ? null : quote(daily.selected),
    ...(daily.override === undefined ? {} : { override: quote(daily.override) }),
  } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
