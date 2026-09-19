/** Date helpers. All dates are calendar dates (YYYY-MM-DD) handled in UTC to avoid DST/timezone drift. */
export const APP_TIMEZONE = "Asia/Kolkata";
export const DAYS_PER_MONTH = 30.4375;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_MONTH = /^(\d{4})-(\d{2})$/;

export const isValidISODate = (s: unknown): s is string => {
  if (typeof s !== "string") return false;
  const m = ISO_DATE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
};

export const isValidMonth = (s: unknown): s is string => {
  if (typeof s !== "string") return false;
  const m = ISO_MONTH.exec(s);
  if (!m) return false;
  const mo = Number(m[2]);
  return mo >= 1 && mo <= 12;
};

const toDate = (iso: string): Date => {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
};

const fmt = (dt: Date): string => dt.toISOString().slice(0, 10);

export const addDays = (iso: string, days: number): string => {
  const dt = toDate(iso);
  dt.setUTCDate(dt.getUTCDate() + days);
  return fmt(dt);
};

export const daysBetween = (fromIso: string, toIso: string): number =>
  Math.round((toDate(toIso).getTime() - toDate(fromIso).getTime()) / 86_400_000);

export const monthOf = (iso: string): string => iso.slice(0, 7);

/** "2026-09" -> "2026-09-01" */
export const monthStart = (month: string): string => `${month}-01`;

export const addMonths = (month: string, delta: number): string => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const idx = y * 12 + (m - 1) + delta;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return `${ny}-${String(nm).padStart(2, "0")}`;
};

/** Exclusive upper bound: first day of the following month. */
export const nextMonthStart = (month: string): string => monthStart(addMonths(month, 1));

/** The `count` months ending at (and including) `endMonth`, oldest first. */
export const lastNMonths = (endMonth: string, count: number): string[] =>
  Array.from({ length: count }, (_, i) => addMonths(endMonth, i - (count - 1)));

/** 0 = Sunday ... 6 = Saturday */
export const weekdayOf = (iso: string): number => toDate(iso).getUTCDay();

/** Today's calendar date in the app timezone (IST). */
export const todayISO = (now: Date = new Date()): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

export const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export type DateHint =
  | { kind: "none" | "today" | "yesterday" | "day_before_yesterday" }
  | { kind: "days_ago"; n: number }
  | { kind: "last_weekday"; weekday: Weekday }
  | { kind: "explicit"; date: string };

/**
 * Resolves a relative-date hint against the caller-supplied `today` (never the server clock).
 * last_weekday = the most recent such weekday strictly before today ("last Friday").
 * Returns null when the hint is unusable (caller decides how to fall back).
 */
export function resolveDateHint(hint: DateHint, today: string): string | null {
  switch (hint.kind) {
    case "none":
    case "today":
      return today;
    case "yesterday":
      return addDays(today, -1);
    case "day_before_yesterday":
      return addDays(today, -2);
    case "days_ago":
      return Number.isInteger(hint.n) && hint.n >= 0 && hint.n <= 366 ? addDays(today, -hint.n) : null;
    case "last_weekday": {
      const target = WEEKDAYS.indexOf(hint.weekday);
      if (target < 0) return null;
      const diff = ((weekdayOf(today) - target + 7) % 7) || 7;
      return addDays(today, -diff);
    }
    case "explicit":
      return isValidISODate(hint.date) ? hint.date : null;
  }
}

const daysInMonth = (month: string): number => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

/** Same day-of-month n months later, clamped to the month's last day (Jan 31 + 1 month = Feb 28). */
export const addMonthsClamped = (iso: string, n: number): string => {
  const month = addMonths(monthOf(iso), n);
  const day = Math.min(Number(iso.slice(8, 10)), daysInMonth(month));
  return `${month}-${String(day).padStart(2, "0")}`;
};

/** Whole calendar months from `from` to `to`, rounded up; 0 when `to` is not after `from`. */
export function ceilMonthsBetween(from: string, to: string): number {
  if (to <= from) return 0;
  let m = (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + (Number(to.slice(5, 7)) - Number(from.slice(5, 7)));
  while (m > 0 && addMonthsClamped(from, m) > to) m--;
  return addMonthsClamped(from, m) < to ? m + 1 : m;
}
