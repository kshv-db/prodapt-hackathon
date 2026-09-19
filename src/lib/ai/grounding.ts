/**
 * Numeric grounding check: the model may only quote figures that code computed.
 * Every "significant" number in AI text must appear in the allowed facts.
 *
 * Significant means: has a ₹/Rs prefix, a %, a k/L/lakh/cr suffix, or is above 10.
 * Small counts ("3 orders") and year-like values (1900-2100) are ignored.
 */

const TOKEN = /(₹|Rs\.?\s?)?(\d[\d,]*(?:\.\d+)?)\s?(%|k\b|K\b|L\b|lakh\b|Lakh\b|cr\b|crore\b)?/g;

const SUFFIX: Record<string, number> = {
  k: 1e3,
  K: 1e3,
  L: 1e5,
  lakh: 1e5,
  Lakh: 1e5,
  cr: 1e7,
  crore: 1e7,
};

/** Collects every number found in a JSON-like value, including numbers inside strings. */
export function collectNumbers(value: unknown, out: Set<number> = new Set()): Set<number> {
  if (typeof value === "number" && Number.isFinite(value)) {
    out.add(value);
  } else if (typeof value === "string") {
    // Ids are not figures; their digits must not widen what the model may quote.
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return out;
    for (const m of value.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
      const n = Number(m[0].replace(/,/g, ""));
      if (Number.isFinite(n)) out.add(n);
    }
  } else if (Array.isArray(value)) {
    for (const v of value) collectNumbers(v, out);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value)) collectNumbers(v, out);
  }
  return out;
}

function isGrounded(value: number, scaled: boolean, allowed: Set<number>): boolean {
  for (const a of allowed) {
    const tolerance = scaled ? Math.abs(a) * 0.05 : 0.5;
    if (Math.abs(a - value) <= Math.max(tolerance, 0.5)) return true;
    // Percentages and averages the model rounds: 82.4 -> 82
    if (Math.abs(Math.round(a) - value) < 0.01) return true;
  }
  return false;
}

/** Returns the numbers in `text` that are not present in `allowedSources`. Empty array means grounded. */
export function findUngroundedNumbers(text: string, ...allowedSources: unknown[]): string[] {
  const allowed = new Set<number>();
  for (const src of allowedSources) collectNumbers(src, allowed);

  const bad: string[] = [];
  for (const m of text.matchAll(TOKEN)) {
    const [raw, currency, digits, suffix] = m;
    const base = Number(digits.replace(/,/g, ""));
    if (!Number.isFinite(base)) continue;

    const multiplier = suffix && suffix !== "%" ? (SUFFIX[suffix] ?? 1) : 1;
    const value = base * multiplier;
    const significant = Boolean(currency) || suffix === "%" || multiplier !== 1 || base > 10;
    if (!significant) continue;
    if (!currency && !suffix && Number.isInteger(base) && base >= 1900 && base <= 2100) continue;

    if (!isGrounded(value, multiplier !== 1, allowed)) bad.push(raw.trim());
  }
  return bad;
}
