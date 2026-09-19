import { DAYS_PER_MONTH, daysBetween } from "./dates";
import { FinanceInputError } from "./errors";
import { round2 } from "./money";

export interface WhatIfGoal {
  id: string;
  title: string;
  remaining: number;
  deadline: string;
}

export interface WhatIfInput {
  monthlyCost: number;
  months: number;
  income: number;
  avgMonthlySavings: number;
  goals: readonly WhatIfGoal[];
  today: string;
}

export interface BudgetImpact {
  monthlyCost: number;
  months: number;
  totalCost: number;
  incomeShare: number; // monthlyCost / income (0 when income unknown)
  savingsBefore: number;
  savingsAfter: number; // may be negative: the new cost exceeds current savings
  shortfall: number; // monthly amount not covered by current savings
  savingsRateBefore: number;
  savingsRateAfter: number; // floored at 0
}

export interface GoalDelay {
  goalId: string;
  title: string;
  /** Months to reach the goal at current savings; null when savings are 0 (never). */
  monthsBefore: number | null;
  monthsAfter: number | null;
  /** monthsAfter - monthsBefore; null when either is unreachable. */
  delayMonths: number | null;
  missesDeadline: boolean;
  missedDeadlineBefore: boolean;
}

export interface WhatIfResult {
  budgetImpact: BudgetImpact;
  goalDelays: GoalDelay[];
}

/** Months to accumulate `remaining` when saving `during` for `months`, then `after` per month. */
export function monthsToReach(remaining: number, during: number, months: number, after: number): number | null {
  if (remaining <= 0) return 0;
  const d = Math.max(0, during);
  const a = Math.max(0, after);
  if (d > 0 && d * months >= remaining) return remaining / d;
  const left = remaining - d * months;
  if (a <= 0) return null;
  return months + left / a;
}

export function calculateWhatIf(input: WhatIfInput): WhatIfResult {
  const { monthlyCost, months, income, avgMonthlySavings, goals, today } = input;
  if (!Number.isFinite(monthlyCost) || monthlyCost <= 0) throw new FinanceInputError("monthlyCost must be greater than 0");
  if (!Number.isInteger(months) || months < 1) throw new FinanceInputError("months must be a positive integer");

  const before = Math.max(0, avgMonthlySavings);
  const rawAfter = before - monthlyCost;
  const rate = (s: number) => (income > 0 ? Math.max(0, s) / income : 0);

  const goalDelays = goals
    .filter((g) => g.remaining > 0)
    .map((g): GoalDelay => {
      const mBefore = monthsToReach(g.remaining, before, Number.POSITIVE_INFINITY, before);
      const mAfter = monthsToReach(g.remaining, rawAfter, months, before);
      const deadlineMonths = Math.max(0, daysBetween(today, g.deadline)) / DAYS_PER_MONTH;
      return {
        goalId: g.id,
        title: g.title,
        monthsBefore: mBefore === null ? null : round2(mBefore),
        monthsAfter: mAfter === null ? null : round2(mAfter),
        delayMonths: mBefore === null || mAfter === null ? null : round2(mAfter - mBefore),
        missesDeadline: mAfter === null || mAfter > deadlineMonths,
        missedDeadlineBefore: mBefore === null || mBefore > deadlineMonths,
      };
    });

  return {
    budgetImpact: {
      monthlyCost: round2(monthlyCost),
      months,
      totalCost: round2(monthlyCost * months),
      incomeShare: income > 0 ? round2(monthlyCost / income) : 0,
      savingsBefore: round2(before),
      savingsAfter: round2(rawAfter),
      shortfall: round2(Math.max(0, monthlyCost - before)),
      savingsRateBefore: round2(rate(before)),
      savingsRateAfter: round2(rate(rawAfter)),
    },
    goalDelays,
  };
}
