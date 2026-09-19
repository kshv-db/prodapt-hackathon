import { sanitizeText } from "@/lib/ai/prompts";
import { monthOf } from "@/lib/finance/dates";
import { round2 } from "@/lib/finance/money";
import { ASSUMED_ANNUAL_RETURN, calculateProjection, finalBalance } from "@/lib/finance/projection";
import { loadSnapshot, type Snapshot } from "./analytics";
import type { Store } from "./store";

const RECENT_EXPENSES = 10;
const pct = (share: number) => Math.round(share * 100);

/**
 * The ONLY financial data AI models are allowed to see. Compact, computed by code, with all
 * user-controlled strings sanitised. `unavailable` lists what is missing so the model can say so
 * instead of guessing. Percent fields are whole numbers (e.g. 38 means 38%).
 */
export function factSheetFromSnapshot(s: Snapshot, recent: { date: string; amount: number; category: string; merchant: string }[]) {
  const total = s.aggregates.total;
  const budgetTotal = s.budgets.reduce((a, b) => a + b.limit_amount, 0);
  const projection = calculateProjection({ monthlySaving: s.baseline.avgMonthlySavings, years: 5 });
  const unavailable: string[] = [];
  if (s.income <= 0) unavailable.push("monthly income is not set");
  if (s.aggregates.count === 0) unavailable.push("no expenses recorded this month");
  if (s.budgets.length === 0) unavailable.push("no budget set for this month");
  if (s.goals.length === 0) unavailable.push("no savings goals set");
  if (!s.baseline.hasData) unavailable.push("not enough spending history to estimate average savings");
  unavailable.push("prices of items the user may want to buy (unless stated by the user)");

  return {
    asOf: s.today,
    currency: "INR",
    persona: s.profile?.persona ?? "friendly",
    profile: {
      name: sanitizeText(s.profile?.name ?? "", 40) || null,
      monthlyIncome: s.income,
      fixedCosts: (s.profile?.fixed_costs ?? []).slice(0, 15).map((f) => ({ name: sanitizeText(f.name, 40), amount: f.amount })),
    },
    currentMonth: {
      month: s.month,
      totalSpent: round2(total),
      incomeMinusSpent: round2(s.income - total),
      spendingByCategory: s.aggregates.byCategory.map((c) => ({
        category: c.category,
        amount: round2(c.total),
        percentOfSpend: total > 0 ? pct(c.total / total) : 0,
      })),
      topMerchants: s.aggregates.topMerchants.map((m) => ({ merchant: sanitizeText(m.merchant, 40), amount: round2(m.total), orders: m.count })),
      lateNightDiscretionarySpend: round2(s.aggregates.lateNightDiscretionary),
      lateNightDiscretionaryPercentOfSpend: total > 0 ? pct(s.aggregates.lateNightDiscretionary / total) : 0,
    },
    budget: {
      totalBudgeted: round2(budgetTotal),
      usage: s.budgetUsage.map((u) => ({
        category: u.category,
        limit: u.limit,
        spent: u.spent,
        percentUsed: Math.round(u.percent),
        status: u.status,
      })),
    },
    savings: {
      averageMonthlySavings: s.baseline.avgMonthlySavings,
      savingsRatePercent: pct(s.baseline.savingsRate),
      basedOnMonths: s.baseline.monthsUsed.length,
    },
    goals: s.goalPlans.map(({ goal, plan }) => ({
      title: sanitizeText(goal.title, 60),
      target: goal.target_amount,
      saved: goal.saved_amount,
      remaining: plan.remaining,
      deadline: goal.deadline,
      monthsLeft: plan.monthsLeft,
      monthlyNeeded: plan.monthlyNeeded,
      onTrack: plan.onTrack,
      monthlyGap: plan.gap,
      status: plan.status,
    })),
    health: {
      score: s.health.score,
      reason: s.health.reason,
    },
    projection: {
      assumedAnnualReturnPercent: ASSUMED_ANNUAL_RETURN * 100,
      note: "Assumed return, not a promise. Current path = average monthly savings continued.",
      currentPathMonthlySaving: s.baseline.avgMonthlySavings,
      currentPathBalanceIn5Years: finalBalance(projection),
    },
    recentExpenses: recent.map((r) => ({ date: r.date, amount: r.amount, category: r.category, merchant: sanitizeText(r.merchant, 40) })),
    unavailable,
  };
}

export type FinancialFactSheet = ReturnType<typeof factSheetFromSnapshot>;

/** buildFinancialFactSheet(user) - the store is already bound to the authenticated user. */
export async function buildFinancialFactSheet(store: Store, today: string): Promise<FinancialFactSheet> {
  const month = monthOf(today);
  const [snapshot, recent] = await Promise.all([loadSnapshot(store, month, today), store.listRecentExpenses(RECENT_EXPENSES)]);
  return factSheetFromSnapshot(
    snapshot,
    recent.map((e) => ({ date: e.spent_on, amount: e.amount, category: e.category, merchant: e.merchant })),
  );
}
