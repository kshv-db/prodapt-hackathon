/** Code-side checks that run after the model responds. Pure functions, no I/O. */

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function checkNarrative(text: string): string[] {
  const words = wordCount(text);
  return words >= 60 && words <= 90 ? [] : [`must be 60 to 90 words, got ${words}`];
}

const DAY_MS = 24 * 60 * 60 * 1000;

function parseIsoDate(s: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  // Rejects 2026-02-31 style dates that Date would silently roll over.
  return back.getUTCFullYear() === y && back.getUTCMonth() === mo - 1 && back.getUTCDate() === d ? t : null;
}

/** A parsed expense date must be a real date, not in the future, and not older than a year. */
export function checkExpenseDate(spentOn: string, today: string): string | null {
  const t = parseIsoDate(spentOn);
  const now = parseIsoDate(today);
  if (t === null || now === null) return "not a valid date";
  if (t > now) return "date is in the future";
  if (now - t > 366 * DAY_MS) return "date is more than a year ago";
  return null;
}
