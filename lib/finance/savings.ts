import { addMonths } from "./dates";
import { clamp, round2 } from "./money";

export interface MonthlySpend {
  month: string; // YYYY-MM
  total: number;
  count: number; // number of expenses recorded (0 => no data for that month)
}

export interface SavingsBaseline {
  /** Average of (income - spend) over the baseline months, floored at 0. */
  avgMonthlySavings: number;
  /** Months used, oldest first. Empty when the user has no usable data. */
  monthsUsed: string[];
  /** avgMonthlySavings / income, clamped to [0, 1]. 0 when income is unknown. */
  savingsRate: number;
  hasData: boolean;
}

/**
 * Baseline = those of the 3 calendar months before `currentMonth` that have expense data.
 * Months with no recorded expenses are skipped (an empty month is "no data", not "saved everything").
 * If no completed month has data, fall back to the current month-to-date; else no data.
 */
export function calculateSavingsBaseline(
  monthly: readonly MonthlySpend[],
  income: number,
  currentMonth: string,
  window = 3,
): SavingsBaseline {
  const safeIncome = Number.isFinite(income) && income > 0 ? income : 0;
  const windowStart = addMonths(currentMonth, -window);
  const completed = monthly
    .filter((m) => m.month >= windowStart && m.month < currentMonth && m.count > 0)
    .sort((a, b) => a.month.localeCompare(b.month));
  const chosen = completed.length > 0 ? completed : monthly.filter((m) => m.month === currentMonth && m.count > 0);
  if (chosen.length === 0 || safeIncome === 0) {
    return { avgMonthlySavings: 0, monthsUsed: chosen.map((m) => m.month), savingsRate: 0, hasData: chosen.length > 0 };
  }
  const avg = chosen.reduce((acc, m) => acc + (safeIncome - m.total), 0) / chosen.length;
  const floored = Math.max(0, avg);
  return {
    avgMonthlySavings: round2(floored),
    monthsUsed: chosen.map((m) => m.month),
    savingsRate: clamp(floored / safeIncome, 0, 1),
    hasData: true,
  };
}
