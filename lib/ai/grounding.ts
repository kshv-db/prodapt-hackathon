/**
 * Post-hoc numeric grounding check for generated prose.
 * Every rupee amount, percentage or figure >= 100 in the text must match a number that appears
 * in the FACTS given to the model. Small counts (< 100) and years are ignored.
 */
export function collectFigures(value: unknown, out: number[] = []): number[] {
  if (typeof value === "number" && Number.isFinite(value)) out.push(value);
  else if (Array.isArray(value)) for (const v of value) collectFigures(v, out);
  else if (value && typeof value === "object") for (const v of Object.values(value)) collectFigures(v, out);
  return out;
}

const NUM = String.raw`\d(?:[\d,]*\d)?(?:\.\d+)?`; // digits with optional thousands commas, never a trailing comma
const TOKEN = new RegExp(String.raw`₹\s?${NUM}|${NUM}\s?%|${NUM}`, "g");
const ABBREVIATED = new RegExp(String.raw`${NUM}\s?(?:k|lakhs?|lacs?|crores?|cr|m|million)\b`, "i");

export function findUngroundedFigures(text: string, figures: readonly number[]): string[] {
  const bad: string[] = [];
  const abbreviated = ABBREVIATED.exec(text);
  if (abbreviated) bad.push(abbreviated[0]);

  for (const match of text.match(TOKEN) ?? []) {
    const isMoney = match.startsWith("₹");
    const isPercent = match.trimEnd().endsWith("%");
    const value = Number(match.replace(/[₹%,\s]/g, ""));
    if (!Number.isFinite(value)) continue;
    const isYear = !isMoney && !isPercent && Number.isInteger(value) && value >= 1900 && value <= 2100 && !match.includes(",");
    if (isYear) continue;
    if (!isMoney && !isPercent && value < 100) continue;
    // Compare magnitudes: a fact of -84000 legitimately appears in prose as "₹84,000 less".
    const grounded = figures.some((raw) => {
      const f = Math.abs(raw);
      return Math.abs(f - value) < 0.5 || (isPercent && Math.abs(f * 100 - value) < 0.5);
    });
    if (!grounded) bad.push(match.trim());
  }
  return bad;
}

export const countWords = (text: string): number => text.trim().split(/\s+/).filter(Boolean).length;
