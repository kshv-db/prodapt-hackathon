import { isDiscretionary, isLateNight } from "./categories";
import { addMonths, lastNMonths, monthOf } from "./dates";
import { sumMoney } from "./money";
import type { CategoryAverage } from "./goals";
import type { MonthlySpend } from "./savings";

/** Minimal shape needed for aggregation (a subset of the expenses row). */
export interface ExpenseLike {
  amount: number;
  category: string;
  merchant: string | null;
  spent_on: string; // YYYY-MM-DD
  spent_at: string | null; // HH:MM[:SS]
}

export interface SpendAggregates {
  month: string;
  total: number;
  count: number;
  byCategory: { category: string; total: number }[];
  topMerchants: { merchant: string; total: number; count: number }[];
  /** 6 entries, oldest first, zero-filled. */
  trend: MonthlySpend[];
  discretionaryTotal: number;
  lateNightDiscretionary: number;
}

export const TREND_MONTHS = 6;
export const TOP_MERCHANTS = 5;

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0); // code-unit order == Postgres COLLATE "C"

/**
 * Reference implementation of the dashboard aggregates. Production uses the equivalent SQL function
 * `spend_aggregates` (supabase/migrations); a parity test keeps the two in sync.
 */
export function aggregateSpend(expenses: readonly ExpenseLike[], month: string): SpendAggregates {
  const trendMonths = lastNMonths(month, TREND_MONTHS);
  const trend: MonthlySpend[] = trendMonths.map((m) => {
    const rows = expenses.filter((e) => monthOf(e.spent_on) === m);
    return { month: m, total: sumMoney(rows.map((r) => r.amount)), count: rows.length };
  });
  const inMonth = expenses.filter((e) => monthOf(e.spent_on) === month);

  const cats = new Map<string, number[]>();
  for (const e of inMonth) cats.set(e.category, [...(cats.get(e.category) ?? []), e.amount]);
  const byCategory = [...cats.entries()]
    .map(([category, amounts]) => ({ category, total: sumMoney(amounts) }))
    .sort((a, b) => b.total - a.total || cmp(a.category, b.category));

  const merchants = new Map<string, { display: string; amounts: number[] }>();
  for (const e of inMonth) {
    const name = (e.merchant ?? "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    const cur = merchants.get(key);
    if (cur) {
      cur.amounts.push(e.amount);
      if (cmp(name, cur.display) > 0) cur.display = name;
    } else merchants.set(key, { display: name, amounts: [e.amount] });
  }
  const topMerchants = [...merchants.values()]
    .map((m) => ({ merchant: m.display, total: sumMoney(m.amounts), count: m.amounts.length }))
    .sort((a, b) => b.total - a.total || cmp(a.merchant, b.merchant))
    .slice(0, TOP_MERCHANTS);

  const disc = inMonth.filter((e) => isDiscretionary(e.category));
  return {
    month,
    total: sumMoney(inMonth.map((e) => e.amount)),
    count: inMonth.length,
    byCategory,
    topMerchants,
    trend,
    discretionaryTotal: sumMoney(disc.map((e) => e.amount)),
    lateNightDiscretionary: sumMoney(disc.filter((e) => isLateNight(e.spent_at)).map((e) => e.amount)),
  };
}

/**
 * Average monthly spend per category over the `window` calendar months before `currentMonth`,
 * dividing by the number of those months that have any data (min 1). Mirrors SQL `category_averages`.
 */
export function calculateCategoryAverages(
  expenses: readonly ExpenseLike[],
  currentMonth: string,
  window = 3,
): CategoryAverage[] {
  const start = addMonths(currentMonth, -window);
  const rows = expenses.filter((e) => {
    const m = monthOf(e.spent_on);
    return m >= start && m < currentMonth;
  });
  const monthsWithData = new Set(rows.map((r) => monthOf(r.spent_on))).size;
  const divisor = Math.max(1, monthsWithData);
  const cats = new Map<string, number[]>();
  for (const r of rows) cats.set(r.category, [...(cats.get(r.category) ?? []), r.amount]);
  return [...cats.entries()]
    .map(([category, amounts]) => ({ category, avg: sumMoney(amounts) / divisor }))
    .sort((a, b) => cmp(a.category, b.category));
}
