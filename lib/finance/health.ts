import { clamp, formatINR } from "./money";

export const HEALTH_MAX = { savings: 40, budget: 30, goals: 20, impulse: 10 } as const;
export const TARGET_SAVINGS_RATE = 0.2;
export const IMPULSE_FULL_SHARE = 0.1; // full marks at or under 10%
export const IMPULSE_ZERO_SHARE = 0.3; // zero points at or above 30%

export interface BudgetLine {
  category: string;
  limit: number;
  spent: number;
}

export interface HealthInput {
  income: number;
  /** Fraction of income saved on average (0..1) - see calculateSavingsBaseline. */
  savingsRate: number;
  budgetLines: readonly BudgetLine[];
  /** One entry per goal: true when on track / completed. */
  goalsOnTrack: readonly boolean[];
  lateNightDiscretionary: number;
  totalSpent: number;
}

export interface HealthComponent {
  points: number;
  max: number;
  /** Deterministic facts that explain the points (safe to hand to an LLM). */
  fact: string;
}

export interface HealthScore {
  score: number;
  components: { savings: HealthComponent; budget: HealthComponent; goals: HealthComponent; impulse: HealthComponent };
  /** One-line, deterministic explanation focused on the biggest loss. */
  reason: string;
}

const pct = (n: number) => `${Math.round(n * 100)}%`;
const pts = (n: number) => Math.round(n * 10) / 10;

export function calculateHealthScore(input: HealthInput): HealthScore {
  // Savings rate: 20%+ => 40 pts, linear to 0 at 0%.
  const rate = clamp(input.savingsRate, 0, 1);
  const savingsPts = HEALTH_MAX.savings * clamp(rate / TARGET_SAVINGS_RATE, 0, 1);
  const savingsFact =
    input.income > 0
      ? `Saving ${pct(rate)} of income (target ${pct(TARGET_SAVINGS_RATE)}+)`
      : "Monthly income not set, so savings rate cannot be measured";

  // Budget adherence: proportional loss to total overspend vs total limits. No budget => neutral half.
  const limits = input.budgetLines.reduce((a, l) => a + l.limit, 0);
  const overspend = input.budgetLines.reduce((a, l) => a + Math.max(0, l.spent - l.limit), 0);
  const overCats = input.budgetLines.filter((l) => l.spent > l.limit);
  let budgetPts: number;
  let budgetFact: string;
  if (input.budgetLines.length === 0 || limits <= 0) {
    budgetPts = HEALTH_MAX.budget / 2;
    budgetFact = "No budget set for this month";
  } else {
    budgetPts = HEALTH_MAX.budget * (1 - clamp(overspend / limits, 0, 1));
    budgetFact =
      overCats.length === 0
        ? "No category over its budget"
        : `${overCats.length} categor${overCats.length === 1 ? "y" : "ies"} over budget by ${formatINR(overspend)} in total`;
  }

  // Goals: share of goals on track. No goals => neutral half.
  let goalsPts: number;
  let goalsFact: string;
  if (input.goalsOnTrack.length === 0) {
    goalsPts = HEALTH_MAX.goals / 2;
    goalsFact = "No savings goals set";
  } else {
    const onTrack = input.goalsOnTrack.filter(Boolean).length;
    goalsPts = HEALTH_MAX.goals * (onTrack / input.goalsOnTrack.length);
    goalsFact = `${onTrack} of ${input.goalsOnTrack.length} goals on track`;
  }

  // Impulse: late-night discretionary share of total spend. <=10% full, linear to 0 at 30%.
  const share = input.totalSpent > 0 ? input.lateNightDiscretionary / input.totalSpent : 0;
  const impulsePts =
    HEALTH_MAX.impulse * clamp(1 - (share - IMPULSE_FULL_SHARE) / (IMPULSE_ZERO_SHARE - IMPULSE_FULL_SHARE), 0, 1);
  const impulseFact =
    input.totalSpent > 0
      ? `Late-night discretionary spend is ${pct(share)} of total spend (full marks under ${pct(IMPULSE_FULL_SHARE)})`
      : "No spending recorded this month";

  const components = {
    savings: { points: pts(savingsPts), max: HEALTH_MAX.savings, fact: savingsFact },
    budget: { points: pts(budgetPts), max: HEALTH_MAX.budget, fact: budgetFact },
    goals: { points: pts(goalsPts), max: HEALTH_MAX.goals, fact: goalsFact },
    impulse: { points: pts(impulsePts), max: HEALTH_MAX.impulse, fact: impulseFact },
  };

  const score = Math.round(clamp(savingsPts + budgetPts + goalsPts + impulsePts, 0, 100));
  return { score, components, reason: buildReason(score, components) };
}

function buildReason(score: number, c: HealthScore["components"]): string {
  const entries = Object.values(c);
  const lost = entries.map((e) => ({ e, loss: e.max - e.points })).sort((a, b) => b.loss - a.loss);
  const worst = lost[0];
  if (!worst || worst.loss < 1) return `Score ${score}/100: ${c.savings.fact}, and everything else is on track.`;
  return `Score ${score}/100. Biggest drag: ${worst.e.fact}.`;
}
