import type { SpendAggregates } from "@/lib/finance/aggregate";
import { monthOf } from "@/lib/finance/dates";
import { calculateGoalPlan, type CategoryAverage, type GoalPlan } from "@/lib/finance/goals";
import { calculateHealthScore, type BudgetLine, type HealthScore } from "@/lib/finance/health";
import { round2 } from "@/lib/finance/money";
import { calculateSavingsBaseline, type SavingsBaseline } from "@/lib/finance/savings";
import type { BudgetRow, Goal, Profile, Store } from "./store";

export type BudgetStatus = "ok" | "warning" | "over";

export interface BudgetUsageRow {
  category: string;
  limit: number;
  spent: number;
  percent: number;
  status: BudgetStatus;
}

export const WARNING_THRESHOLD = 0.8;

export function calculateBudgetUsage(budgets: readonly BudgetRow[], byCategory: readonly { category: string; total: number }[]): BudgetUsageRow[] {
  const spentBy = new Map(byCategory.map((c) => [c.category, c.total] as const));
  return budgets.map((b) => {
    const spent = spentBy.get(b.category) ?? 0;
    const limit = b.limit_amount;
    const ratio = limit > 0 ? spent / limit : spent > 0 ? 1 : 0;
    const status: BudgetStatus = ratio >= 1 ? "over" : ratio >= WARNING_THRESHOLD ? "warning" : "ok";
    return { category: b.category, limit: round2(limit), spent: round2(spent), percent: round2(ratio * 100), status };
  });
}

export interface Snapshot {
  month: string;
  today: string;
  profile: Profile | null;
  income: number;
  aggregates: SpendAggregates;
  categoryAverages: CategoryAverage[];
  budgets: BudgetRow[];
  budgetUsage: BudgetUsageRow[];
  goals: Goal[];
  goalPlans: { goal: Goal; plan: GoalPlan }[];
  baseline: SavingsBaseline;
  health: HealthScore;
}

/**
 * Loads everything derived numbers depend on (5 parallel queries, no N+1) and computes them with the
 * pure finance library. Shared by /summary, the AI fact sheet, /future, goal plans and what-if.
 */
export async function loadSnapshot(store: Store, month: string, today: string): Promise<Snapshot> {
  const [profile, aggregates, categoryAverages, budgets, goals] = await Promise.all([
    store.getProfile(),
    store.getSpendAggregates(month),
    store.getCategoryAverages(month),
    store.listBudgets(month),
    store.listGoals(),
  ]);
  return computeSnapshot({ month, today, profile, aggregates, categoryAverages, budgets, goals });
}

export function computeSnapshot(input: {
  month: string;
  today: string;
  profile: Profile | null;
  aggregates: SpendAggregates;
  categoryAverages: CategoryAverage[];
  budgets: BudgetRow[];
  goals: Goal[];
}): Snapshot {
  const { month, today, profile, aggregates, categoryAverages, budgets, goals } = input;
  const income = profile?.monthly_income ?? 0;
  const baseline = calculateSavingsBaseline(aggregates.trend, income, month);
  const budgetUsage = calculateBudgetUsage(budgets, aggregates.byCategory);
  const goalPlans = goals.map((goal) => ({
    goal,
    plan: calculateGoalPlan({ target: goal.target_amount, saved: goal.saved_amount, deadline: goal.deadline }, today, baseline.avgMonthlySavings),
  }));
  const budgetLines: BudgetLine[] = budgetUsage.map((u) => ({ category: u.category, limit: u.limit, spent: u.spent }));
  const health = calculateHealthScore({
    income,
    savingsRate: baseline.savingsRate,
    budgetLines,
    goalsOnTrack: goalPlans.map((g) => g.plan.onTrack),
    lateNightDiscretionary: aggregates.lateNightDiscretionary,
    totalSpent: aggregates.total,
  });
  return { month, today, profile, income, aggregates, categoryAverages, budgets, budgetUsage, goals, goalPlans, baseline, health };
}

export const currentMonthOf = (today: string) => monthOf(today);
