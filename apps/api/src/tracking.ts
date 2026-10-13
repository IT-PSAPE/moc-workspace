import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { MinistryRequest, WorkspaceState } from "@moc/shared";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_SHAPE = /^MOC[0-9A-HJKMNP-TV-Z]{24}$/;

/** Generate a 120-bit bearer code issued once and reusable for authorized access. */
export function createTrackingCode(): string {
  const bytes = randomBytes(15);
  let bits = 0;
  let buffer = 0;
  let encoded = "";
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      encoded += CROCKFORD[(buffer >>> bits) & 31];
      buffer &= (1 << bits) - 1;
    }
  }
  return `MOC-${encoded.match(/.{6}/g)!.join("-")}`;
}

/** Format is cosmetic: spaces and hyphens are ignored, case is folded. */
export function normalizeTrackingCode(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 128) return null;
  const normalized = value.replace(/[\s-]/g, "").toUpperCase();
  return CODE_SHAPE.test(normalized) ? normalized : null;
}

export function hashTrackingCode(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Scan every stored digest and compare fixed-length hashes in constant time. */
export function findRequestByTrackingCode(
  state: WorkspaceState,
  submittedCode: unknown,
): MinistryRequest | null {
  const normalized = normalizeTrackingCode(submittedCode);
  const candidate = Buffer.from(
    hashTrackingCode(normalized ?? "invalid-tracking-code"),
    "hex",
  );
  let match: MinistryRequest | null = null;
  for (const request of state.requests) {
    const stored = request.trackingCodeHash;
    const digest = /^[a-f0-9]{64}$/i.test(stored ?? "")
      ? Buffer.from(stored!, "hex")
      : Buffer.alloc(32);
    const equal = timingSafeEqual(candidate, digest);
    if (normalized && stored && equal) match = request;
  }
  return match;
}

export const DEMO_TRACKING_CODES = [
  "MOC-222222-222222-222222-222222",
  "MOC-333333-333333-333333-333333",
  "MOC-444444-444444-444444-444444",
  "MOC-555555-555555-555555-555555",
] as const;
