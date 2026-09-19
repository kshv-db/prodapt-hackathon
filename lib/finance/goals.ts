import { isDiscretionary } from "./categories";
import { ceilMonthsBetween, daysBetween } from "./dates";
import { floorTo, round2 } from "./money";

export type GoalStatus = "completed" | "active" | "due_today" | "expired";

export interface GoalInput {
  target: number;
  saved: number;
  deadline: string; // YYYY-MM-DD
}

export interface GoalPlan {
  remaining: number;
  /** Whole months until the deadline (rounded up); 0 when the deadline is today or past. */
  monthsLeft: number;
  status: GoalStatus;
  monthlyNeeded: number;
  onTrack: boolean;
  /** Extra monthly saving required beyond the current average; 0 when on track. */
  gap: number;
}

/**
 * monthsLeft    = whole calendar months from today to the deadline, rounded up
 * monthlyNeeded = remaining / max(1, monthsLeft)   (so today/past deadlines never divide by zero)
 * onTrack       = avgMonthlySavings >= monthlyNeeded  (completed => true, expired => false)
 */
export function calculateGoalPlan(goal: GoalInput, today: string, avgMonthlySavings: number): GoalPlan {
  const remaining = Math.max(0, goal.target - goal.saved);
  const days = daysBetween(today, goal.deadline);
  const monthsLeft = ceilMonthsBetween(today, goal.deadline);
  const savings = Math.max(0, avgMonthlySavings);

  if (remaining <= 0) {
    return { remaining: 0, monthsLeft, status: "completed", monthlyNeeded: 0, onTrack: true, gap: 0 };
  }
  const status: GoalStatus = days < 0 ? "expired" : days === 0 ? "due_today" : "active";
  const monthlyNeeded = remaining / Math.max(1, monthsLeft);
  const onTrack = status === "expired" ? false : savings >= monthlyNeeded;
  return {
    remaining: round2(remaining),
    monthsLeft,
    status,
    monthlyNeeded: round2(monthlyNeeded),
    onTrack,
    gap: round2(Math.max(0, monthlyNeeded - savings)),
  };
}

export interface CategoryAverage {
  category: string;
  avg: number;
}

export interface SuggestedCut {
  category: string;
  amount: number;
  /** True when this single cut fully closes the monthly gap. */
  closesGap: boolean;
}

/** A single cut may take at most this share of the category's average monthly spend. */
export const MAX_CUT_SHARE = 0.5;
const CUT_STEP = 10;

/** Picks the discretionary category with the highest average spend and sizes a cut to close `gap`. */
export function suggestCut(gap: number, averages: readonly CategoryAverage[]): SuggestedCut | null {
  if (gap <= 0) return null;
  const top = averages
    .filter((a) => isDiscretionary(a.category) && a.avg > 0)
    .sort((a, b) => b.avg - a.avg || a.category.localeCompare(b.category))[0];
  if (!top) return null;
  const wanted = Math.ceil(gap / CUT_STEP) * CUT_STEP;
  const cap = floorTo(top.avg * MAX_CUT_SHARE, CUT_STEP);
  const amount = Math.min(wanted, cap);
  if (amount <= 0) return null;
  return { category: top.category, amount, closesGap: amount >= gap };
}
