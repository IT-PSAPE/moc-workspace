#!/usr/bin/env node
/**
 * Verifies the colour pairings in packages/ui/src/theme.css against WCAG 2.1 AA.
 *
 * Text pairs need 4.5:1 (SC 1.4.3). Control edges, focus indicators and
 * meaningful graphics need 3:1 (SC 1.4.11). Run after touching the token ramps:
 *
 *   node scripts/check-contrast.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const themePath = resolve(here, "../packages/ui/src/theme.css");

/** Resolve every `--token: value` in :root, following var() aliases. */
function readTokens(css) {
  const raw = new Map();
  for (const [, name, value] of css.matchAll(/^\s*(--[\w-]+)\s*:\s*([^;]+);/gm)) {
    raw.set(name, value.trim());
  }
  const resolveToken = (name, seen = new Set()) => {
    if (seen.has(name)) throw new Error(`Circular token reference: ${name}`);
    seen.add(name);
    const value = raw.get(name);
    if (!value) return undefined;
    const alias = value.match(/^var\((--[\w-]+)\)$/);
    return alias ? resolveToken(alias[1], seen) : value;
  };
  const out = new Map();
  for (const name of raw.keys()) {
    const value = resolveToken(name);
    if (value && /^#[0-9a-f]{6}$/i.test(value)) out.set(name, value);
  }
  return out;
}

const channel = (c) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

function luminance(hex) {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/* Every pairing the interface actually renders. `min` is the SC that applies. */
const PAIRS = [
  // Body and heading text
  ["--ink", "--canvas", 4.5, "page text on canvas"],
  ["--ink", "--surface", 4.5, "card text on surface"],
  ["--ink-secondary", "--surface", 4.5, "secondary text on surface"],
  ["--ink-secondary", "--canvas", 4.5, "secondary text on canvas"],
  ["--muted", "--surface", 4.5, "metadata on surface"],
  ["--muted", "--canvas", 4.5, "metadata on canvas"],
  ["--muted", "--surface-sunken", 4.5, "metadata on sunken surface"],

  // Placeholders are text that must stay legible (SC 1.4.3 applies at 3:1
  // only because they are always paired with a visible label).
  ["--ink-placeholder", "--surface", 3, "placeholder on surface"],

  // Brand
  ["--ink-on-brand", "--brand-fill", 4.5, "primary button label"],
  ["--ink-on-brand", "--brand-fill-hover", 4.5, "primary button label (hover)"],
  ["--ink-on-brand", "--brand-fill-active", 4.5, "primary button label (active)"],
  ["--brand-700", "--surface", 4.5, "link on surface"],
  ["--brand-700", "--canvas", 4.5, "link on canvas"],
  ["--brand-700", "--brand-50", 4.5, "brand badge"],

  // Status
  ["--success-text", "--success-bg", 4.5, "success badge"],
  ["--warning-text", "--warning-bg", 4.5, "warning badge"],
  ["--danger-text", "--danger-bg", 4.5, "danger badge"],
  ["--info-text", "--info-bg", 4.5, "info badge"],

  // Department accents
  ["--dept-sound-fg", "--dept-sound-bg", 4.5, "Sound mark"],
  ["--dept-design-fg", "--dept-design-bg", 4.5, "Design mark"],
  ["--dept-visual-fg", "--dept-visual-bg", 4.5, "Visual Media mark"],
  ["--dept-cell0-fg", "--dept-cell0-bg", 4.5, "Cell 0 mark"],

  ...["red", "orange", "cyan", "indigo", "lime", "slate"].map((color) => [
    `--palette-${color}-fg`, `--palette-${color}-bg`, 4.5, `${color} department badge`,
  ]),

  // Non-text contrast: control edges and meaningful graphics
  ["--line-control", "--surface", 3, "input/button edge on surface"],
  ["--line-control", "--canvas", 3, "input/button edge on canvas"],
];

const tokens = readTokens(readFileSync(themePath, "utf8"));

let failed = 0;
const rows = PAIRS.map(([fg, bg, min, label]) => {
  const a = tokens.get(fg);
  const b = tokens.get(bg);
  if (!a || !b) {
    failed++;
    return { label, ratio: null, min, note: `missing token ${!a ? fg : bg}` };
  }
  const ratio = contrast(a, b);
  if (ratio < min) failed++;
  return { label, ratio, min, note: `${fg} on ${bg}` };
});

const width = Math.max(...rows.map((r) => r.label.length));
for (const { label, ratio, min, note } of rows) {
  if (ratio === null) {
    console.log(`FAIL  ${label.padEnd(width)}  ${note}`);
    continue;
  }
  const ok = ratio >= min;
  console.log(
    `${ok ? "pass" : "FAIL"}  ${label.padEnd(width)}  ${ratio.toFixed(2).padStart(5)}:1  (needs ${min}:1)  ${note}`,
  );
}

console.log(
  `\n${rows.length - failed}/${rows.length} pairings meet WCAG 2.1 AA.`,
);
process.exit(failed ? 1 : 0);
