import { narrate } from "@/lib/ai/narrator";
import { TASK_TIER } from "@/lib/ai/config";
import { generateBudget, type FixedCost } from "@/lib/finance/budget";
import { monthOf, monthStart } from "@/lib/finance/dates";
import { calculateGoalPlan, suggestCut, type SuggestedCut } from "@/lib/finance/goals";
import { formatINR, round2 } from "@/lib/finance/money";
import { calculateProjection, finalBalance, ASSUMED_ANNUAL_RETURN, type ProjectionPoint } from "@/lib/finance/projection";
import { calculateWhatIf } from "@/lib/finance/whatif";
import { badRequest, conflict, notFound } from "@/lib/errors";
import { polishBudgetReasons } from "@/lib/ai/budget-reasons";
import { loadSnapshot } from "./analytics";
import { buildFinancialFactSheet, type FinancialFactSheet } from "./fact-sheet";
import type { BudgetInputRow, Store } from "./store";
import type { PersonaId } from "@/lib/finance/categories";

const personaOf = (p: { persona: PersonaId } | null): PersonaId => p?.persona ?? "friendly";

/* ---------------------------------------------------------------- summary */

export async function buildSummary(store: Store, month: string, today: string) {
  const [snap, insight] = await Promise.all([loadSnapshot(store, month, today), store.latestInsight()]);
  const { aggregates: a, health } = snap;
  const total = a.total;
  return {
    month,
    total: round2(total),
    income: round2(snap.income),
    byCategory: a.byCategory.map((c) => ({
      category: c.category,
      total: round2(c.total),
      percent: total > 0 ? round2((c.total / total) * 100) : 0,
    })),
    trend: a.trend.map((t) => ({ month: t.month, total: round2(t.total) })),
    topMerchants: a.topMerchants.map((m) => ({ merchant: m.merchant, total: round2(m.total), count: m.count })),
    budgetUsage: snap.budgetUsage,
    healthScore: health.score,
    healthReason: health.reason,
    // additive, optional-to-consume extras for the dashboard
    budgetTotal: round2(snap.budgets.reduce((acc, b) => acc + b.limit_amount, 0)),
    healthBreakdown: {
      savings: { points: health.components.savings.points, max: health.components.savings.max },
      budget: { points: health.components.budget.points, max: health.components.budget.max },
      goals: { points: health.components.goals.points, max: health.components.goals.max },
      impulse: { points: health.components.impulse.points, max: health.components.impulse.max },
    },
    insight: insight ? { id: insight.id, kind: insight.kind, body: insight.body, created_at: insight.created_at } : null,
  };
}

/* ---------------------------------------------------------------- budgets */

export async function generateBudgetFor(store: Store, input: { income: number; fixedCosts: FixedCost[] }, today: string) {
  const history = await store.getCategoryAverages(monthOf(today));
  const generated = generateBudget({ income: input.income, fixedCosts: input.fixedCosts, history });
  const budgets = await polishBudgetReasons(generated.budgets, generated.savings);
  return {
    budgets: budgets.map((b) => ({ category: b.category, limit: b.limit, reason: b.reason })),
    savings: generated.savings,
    totals: generated.totals,
  };
}

export const budgetToApi = (r: { category: string; limit_amount: number; reason: string | null }) => ({
  category: r.category,
  limit: round2(r.limit_amount),
  reason: r.reason ?? "",
});

export async function saveBudgets(store: Store, month: string, rows: BudgetInputRow[]) {
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.category)) throw badRequest(`Duplicate category in budgets: ${r.category}`);
    seen.add(r.category);
  }
  const profile = await store.getProfile();
  const income = profile?.monthly_income ?? 0;
  const total = rows.reduce((a, r) => a + r.limit, 0);
  if (rows.length > 0 && income <= 0) throw badRequest("Set your monthly income before saving a budget");
  if (total > income + 0.005) {
    throw badRequest(`Budget total ${formatINR(total)} exceeds monthly income ${formatINR(income)}`);
  }
  return (await store.replaceBudgets(month, rows)).map(budgetToApi);
}

/* ------------------------------------------------------------------ goals */

export const goalToApi = (g: { id: string; title: string; target_amount: number; saved_amount: number; deadline: string; created_at: string }) => g;

export async function planForGoal(store: Store, goalId: string, today: string) {
  const [goal, snap] = await Promise.all([store.getGoal(goalId), loadSnapshot(store, monthOf(today), today)]);
  if (!goal) throw notFound("Goal not found");
  const plan = calculateGoalPlan(
    { target: goal.target_amount, saved: goal.saved_amount, deadline: goal.deadline },
    today,
    snap.baseline.avgMonthlySavings,
  );
  const cut: SuggestedCut | null = plan.onTrack ? null : suggestCut(plan.gap, snap.categoryAverages);
  const persona = personaOf(snap.profile);

  const facts = {
    goal: { title: goal.title, target: goal.target_amount, saved: goal.saved_amount, deadline: goal.deadline },
    plan: { remaining: plan.remaining, monthsLeft: plan.monthsLeft, monthlyNeeded: plan.monthlyNeeded, monthlyGap: plan.gap, status: plan.status },
    currentAverageMonthlySavings: snap.baseline.avgMonthlySavings,
    suggestedCut: cut ? { category: cut.category, amountPerMonth: cut.amount, closesGap: cut.closesGap } : null,
  };
  const suggestion = await suggestionText(persona, goal.title, plan.status, plan.onTrack, plan.gap, plan.monthlyNeeded, cut, facts, {
    goalId,
    saved: goal.saved_amount,
    today,
  });

  return {
    monthlyNeeded: plan.monthlyNeeded,
    onTrack: plan.onTrack,
    gap: plan.gap,
    suggestion: suggestion.text,
    // additive fields (optional to consume)
    monthsLeft: plan.monthsLeft,
    remaining: plan.remaining,
    status: plan.status,
    currentMonthlySavings: snap.baseline.avgMonthlySavings,
    cut: cut ? { category: cut.category, amount: cut.amount } : null,
  };
}

async function suggestionText(
  persona: PersonaId,
  title: string,
  status: string,
  onTrack: boolean,
  gap: number,
  monthlyNeeded: number,
  cut: SuggestedCut | null,
  facts: Record<string, unknown>,
  key: { goalId: string; saved: number; today: string },
): Promise<{ text: string }> {
  if (status === "completed") return { text: `You've fully funded "${title}". Time to celebrate, or set a new goal.` };
  if (status === "expired") {
    return { text: `The deadline for "${title}" has passed. Consider moving the deadline or topping up the remaining amount.` };
  }
  if (onTrack) return { text: `You're on track for "${title}": saving ${formatINR(monthlyNeeded)} a month gets you there.` };

  const fallback = cut
    ? `To reach "${title}" you need ${formatINR(monthlyNeeded)} a month, ${formatINR(gap)} more than you save now. Cut ${formatINR(cut.amount)} a month from ${cut.category}${cut.closesGap ? " to close the gap." : " to narrow the gap, and consider a later deadline."}`
    : `To reach "${title}" you need ${formatINR(monthlyNeeded)} a month, ${formatINR(gap)} more than you save now. Consider a later deadline or a smaller target.`;
  const result = await narrate({
    task: "Explain how the user can get an off-track savings goal back on track.",
    tier: TASK_TIER.planSuggestion,
    persona,
    instructions:
      "Write 1-2 sentences (max 45 words). Name the goal, the monthly gap, and the suggestedCut (category and amount) exactly as given in FACTS. If suggestedCut is null, suggest extending the deadline instead. Use only FACTS figures.",
    facts,
    fallback,
    wordRange: [8, 60],
    cacheKey: `plan:${persona}:${key.goalId}:${key.saved}:${key.today}:${gap}:${cut?.category}:${cut?.amount}`,
  });
  return { text: result.text };
}

/* ------------------------------------------------------------- Future You */

export interface FutureResult {
  current: { series: ProjectionPoint[] };
  chosen: { series: ProjectionPoint[] };
  narrative: string;
  currentMonthlySaving: number;
  assumedAnnualReturn: number;
  narrativeSource: "ai" | "fallback";
  disclaimer: string;
}

export const FUTURE_DISCLAIMER = "The 7% annual return is an assumption used for illustration, not a promise or guarantee.";

export async function futureYou(store: Store, input: { monthlySaving: number; years: number }, today: string): Promise<FutureResult> {
  const snap = await loadSnapshot(store, monthOf(today), today); // reads only; nothing is written
  const currentSaving = snap.baseline.avgMonthlySavings;
  const current = calculateProjection({ monthlySaving: currentSaving, years: input.years });
  const chosen = calculateProjection({ monthlySaving: input.monthlySaving, years: input.years });
  const currentEnd = finalBalance(current);
  const chosenEnd = finalBalance(chosen);
  const difference = round2(chosenEnd - currentEnd);
  const persona = personaOf(snap.profile);

  const topGoal = snap.goalPlans
    .filter((g) => g.plan.status !== "completed")
    .sort((a, b) => a.goal.deadline.localeCompare(b.goal.deadline))[0];

  const facts = {
    yearsAhead: input.years,
    assumedAnnualReturnPercent: ASSUMED_ANNUAL_RETURN * 100,
    currentPath: { monthlySaving: currentSaving, balanceAtEnd: currentEnd },
    chosenPath: { monthlySaving: input.monthlySaving, balanceAtEnd: chosenEnd },
    differenceAtEnd: difference,
    goal: topGoal
      ? { title: topGoal.goal.title, remaining: topGoal.plan.remaining, monthlyNeeded: topGoal.plan.monthlyNeeded, deadline: topGoal.goal.deadline, onTrackOnCurrentPath: topGoal.plan.onTrack }
      : null,
  };

  const direction = difference >= 0 ? "more" : "less";
  const fallback =
    `I'm writing to you from ${input.years} years ahead. On the path you were on, saving ${formatINR(currentSaving)} a month, I have ${formatINR(currentEnd)}. ` +
    `Because you chose to save ${formatINR(input.monthlySaving)} a month instead, I have ${formatINR(chosenEnd)}, which is ${formatINR(Math.abs(difference))} ${direction}. ` +
    `Those numbers assume a 7% yearly return, which is an assumption, not a promise. ` +
    `${topGoal ? `Your goal "${topGoal.goal.title}" felt closer with every month you stuck to it. ` : ""}Small, steady choices are what got me here.`;

  const narration = await narrate({
    task: "Write the user's Future You message.",
    tier: TASK_TIER.futureNarrative,
    persona,
    instructions:
      `Write 60 to 90 words, in first person, as the user's future self looking back from ${input.years} years ahead. ` +
      "Compare currentPath and chosenPath using the balances in FACTS, mention differenceAtEnd, mention the goal if FACTS has one, and say the return is an assumption, not a promise. Do not add any other figures.",
    facts,
    fallback,
    wordRange: [60, 90],
    cacheKey: `future:${persona}:${input.years}:${currentSaving}:${input.monthlySaving}:${topGoal?.goal.id ?? "-"}:${topGoal?.goal.saved_amount ?? 0}`,
  });

  return {
    current: { series: current },
    chosen: { series: chosen },
    narrative: narration.text,
    currentMonthlySaving: currentSaving,
    assumedAnnualReturn: ASSUMED_ANNUAL_RETURN,
    narrativeSource: narration.source,
    disclaimer: FUTURE_DISCLAIMER,
  };
}

/* --------------------------------------------------------------- What-If */

export async function whatIf(store: Store, input: { description: string; monthlyCost: number; months: number }, today: string) {
  const snap = await loadSnapshot(store, monthOf(today), today);
  const goals = snap.goalPlans.map(({ goal, plan }) => ({ id: goal.id, title: goal.title, remaining: plan.remaining, deadline: goal.deadline }));
  const result = calculateWhatIf({
    monthlyCost: input.monthlyCost,
    months: input.months,
    income: snap.income,
    avgMonthlySavings: snap.baseline.avgMonthlySavings,
    goals,
    today,
  });
  const persona = personaOf(snap.profile);
  const worst = result.goalDelays.find((g) => g.missesDeadline && !g.missedDeadlineBefore) ?? result.goalDelays[0];
  const bi = result.budgetImpact;
  const fallback =
    `Adding ${formatINR(bi.monthlyCost)} a month for ${bi.months} months costs ${formatINR(bi.totalCost)} in total. ` +
    (bi.savingsAfter >= 0
      ? `Your monthly savings would drop from ${formatINR(bi.savingsBefore)} to ${formatINR(bi.savingsAfter)}.`
      : `That is ${formatINR(bi.shortfall)} a month more than you currently save.`) +
    (worst && worst.delayMonths !== null && worst.delayMonths > 0
      ? ` "${worst.title}" would slip by about ${Math.round(worst.delayMonths)} months.`
      : "");

  const narration = await narrate({
    task: "Explain the impact of a proposed recurring expense (What-If).",
    tier: TASK_TIER.whatIf,
    persona,
    instructions:
      "Write 2-3 sentences (max 70 words) explaining the budget impact and any goal delays using ONLY the figures in FACTS. Do not recompute anything. Do not tell the user what to do beyond a brief suggestion.",
    facts: { description: input.description.slice(0, 120), ...result },
    fallback,
    wordRange: [10, 90],
    cacheKey: `whatif:${persona}:${input.monthlyCost}:${input.months}:${snap.baseline.avgMonthlySavings}:${goals.map((g) => `${g.id}${g.remaining}`).join(",")}`,
  });
  return { budgetImpact: result.budgetImpact, goalDelays: result.goalDelays, narrative: narration.text };
}

/* --------------------------------------------------------------- Insights */

export async function refreshInsight(store: Store, today: string) {
  const facts = await buildFinancialFactSheet(store, today);
  const insight = await narrate({
    task: "Write ONE dashboard insight card for the user.",
    tier: TASK_TIER.insight,
    persona: facts.persona,
    instructions:
      "Write 1 to 2 sentences (max 45 words) about the single most notable pattern in FACTS (for example late-night discretionary spend, a category over budget, or savings rate). Use at least one figure from FACTS, copied exactly. " +
      "If the persona is roast, tease the spending behaviour only and end with an action.",
    facts,
    fallback: fallbackInsight(facts),
    wordRange: [6, 60],
  });
  const row = await store.insertInsight("dashboard", insight.text);
  return { id: row.id, kind: row.kind, body: row.body, created_at: row.created_at };
}

function fallbackInsight(f: FinancialFactSheet): string {
  const cm = f.currentMonth;
  if (cm.totalSpent === 0) return "Add a few expenses and I'll spot patterns in your spending.";
  if (cm.lateNightDiscretionaryPercentOfSpend >= 10) {
    return `${cm.lateNightDiscretionaryPercentOfSpend}% of your spending this month (${formatINR(cm.lateNightDiscretionarySpend)}) is late-night discretionary spend. Trimming a few of those orders is the quickest win.`;
  }
  const over = f.budget.usage.find((u) => u.status === "over");
  if (over) return `${over.category} is over budget: ${formatINR(over.spent)} spent against a ${formatINR(over.limit)} limit.`;
  const top = cm.spendingByCategory[0];
  if (top) return `${top.category} is your biggest category at ${formatINR(top.amount)}, ${top.percentOfSpend}% of this month's spending.`;
  return `You've spent ${formatINR(cm.totalSpent)} this month.`;
}

/* -------------------------------------------------------------------- Seed */

/**
 * Delegates to the canonical seed_demo_data() SQL function (feature/db). It refuses to invent a profile,
 * so onboarding (PUT /profile) must happen first. Re-running replaces the previous seed rows.
 */
export async function seedDemo(store: Store): Promise<void> {
  if (!(await store.getProfile())) throw conflict("Complete onboarding (PUT /api/profile) before loading demo data");
  await store.seedDemo();
}

export { monthStart };
