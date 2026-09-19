import { CATEGORIES, type Category, isCategory, isDiscretionary } from "./categories";
import { FinanceInputError } from "./errors";
import { floorTo, formatINR, round2 } from "./money";
import type { CategoryAverage } from "./goals";

export interface FixedCost {
  name: string;
  amount: number;
  category?: Category;
}

export interface BudgetLimit {
  category: Category;
  limit: number;
  reason: string;
}

export interface GeneratedBudget {
  budgets: BudgetLimit[];
  /** The savings line: what is left after fixed costs and category limits. Not a category. */
  savings: { limit: number; reason: string };
  totals: { income: number; fixedCosts: number; flexible: number; savings: number };
}

export const SAVINGS_TARGET_RATE = 0.2;
const DISCRETIONARY_TRIM = 0.9;
const MIN_SHARE_FACTOR = 0.25;
const LIMIT_STEP = 10;

/** Starter split of the flexible pool when there is no spending history. Sums to 1. */
const DEFAULT_SHARES: Record<Category, number> = {
  "Food & Dining": 0.24,
  Groceries: 0.22,
  Transport: 0.12,
  Shopping: 0.1,
  "Bills & Utilities": 0.08,
  "Rent & EMI": 0,
  Entertainment: 0.06,
  Health: 0.06,
  Education: 0.04,
  Travel: 0.03,
  Subscriptions: 0.03,
  Other: 0.02,
};

const KEYWORDS: [RegExp, Category][] = [
  [/rent|emi|loan|mortgage|hostel|pg\b/i, "Rent & EMI"],
  [/electric|water|gas|wifi|broadband|internet|mobile|phone|recharge|bill/i, "Bills & Utilities"],
  [/netflix|spotify|prime|hotstar|youtube|subscription|ott/i, "Subscriptions"],
  [/insurance|medical|health|gym/i, "Health"],
  [/school|tuition|college|course|fees?/i, "Education"],
  [/bus|metro|fuel|petrol|commute|transport/i, "Transport"],
];

export function inferFixedCostCategory(name: string): Category {
  for (const [re, category] of KEYWORDS) if (re.test(name)) return category;
  return "Bills & Utilities";
}

export interface BudgetInput {
  income: number;
  fixedCosts: readonly FixedCost[];
  /** Monthly average spend per category over recent history (may be empty). */
  history: readonly CategoryAverage[];
}

/**
 * Deterministic budget:
 *   income = fixed costs + flexible category limits + savings line   (exactly, to the paisa)
 * Flexible limits come from 3-month history (discretionary trimmed 10%) or a default split when
 * there is no history, scaled down proportionally if they exceed what is available after a
 * savings target of 20% of income. Anything left over goes to savings.
 */
export function generateBudget({ income, fixedCosts, history }: BudgetInput): GeneratedBudget {
  if (!Number.isFinite(income) || income <= 0) throw new FinanceInputError("income must be greater than 0");
  for (const fc of fixedCosts) {
    if (!Number.isFinite(fc.amount) || fc.amount < 0) throw new FinanceInputError("fixed cost amounts must be >= 0");
  }

  const fixedByCat = new Map<Category, number>();
  for (const fc of fixedCosts) {
    const cat = fc.category && isCategory(fc.category) ? fc.category : inferFixedCostCategory(fc.name);
    fixedByCat.set(cat, (fixedByCat.get(cat) ?? 0) + fc.amount);
  }
  const fixedTotal = [...fixedByCat.values()].reduce((a, b) => a + b, 0);
  if (fixedTotal > income) throw new FinanceInputError("Fixed costs exceed monthly income");

  const available = income - fixedTotal;
  const savingsTarget = Math.min(SAVINGS_TARGET_RATE * income, available);
  const pool = available - savingsTarget;

  const avgByCat = new Map(history.map((h) => [h.category, h.avg] as const));
  const hasHistory = [...avgByCat.values()].some((v) => v > 0);

  const desired = new Map<Category, number>();
  for (const cat of CATEGORIES) {
    const share = DEFAULT_SHARES[cat];
    if (!hasHistory) {
      desired.set(cat, share * pool);
      continue;
    }
    const histVar = Math.max(0, (avgByCat.get(cat) ?? 0) - (fixedByCat.get(cat) ?? 0));
    const adjusted = histVar * (isDiscretionary(cat) ? DISCRETIONARY_TRIM : 1);
    desired.set(cat, Math.max(adjusted, MIN_SHARE_FACTOR * share * pool));
  }
  const desiredTotal = [...desired.values()].reduce((a, b) => a + b, 0);
  const scale = desiredTotal > pool && desiredTotal > 0 ? pool / desiredTotal : 1;

  const budgets: BudgetLimit[] = CATEGORIES.map((category) => {
    const flexible = floorTo((desired.get(category) ?? 0) * scale, LIMIT_STEP);
    const fixed = fixedByCat.get(category) ?? 0;
    return { category, limit: round2(fixed + flexible), reason: reasonFor(category, fixed, flexible, avgByCat.get(category), hasHistory, scale < 1) };
  });

  const limitsTotal = budgets.reduce((a, b) => a + b.limit, 0);
  const savings = round2(Math.max(0, income - limitsTotal));
  return {
    budgets,
    savings: {
      limit: savings,
      reason: `${formatINR(savings)} kept aside for savings (${Math.round((savings / income) * 100)}% of income)`,
    },
    totals: {
      income: round2(income),
      fixedCosts: round2(fixedTotal),
      flexible: round2(limitsTotal - fixedTotal),
      savings,
    },
  };
}

function reasonFor(
  category: Category,
  fixed: number,
  flexible: number,
  avg: number | undefined,
  hasHistory: boolean,
  scaledDown: boolean,
): string {
  const parts: string[] = [];
  if (fixed > 0) parts.push(`${formatINR(fixed)} fixed cost`);
  if (flexible > 0) {
    if (hasHistory && avg && avg > 0) {
      parts.push(
        `${formatINR(flexible)} flexible based on your ${formatINR(avg)} monthly average${isDiscretionary(category) ? ", trimmed 10%" : ""}${scaledDown ? ", fitted to what you can afford" : ""}`,
      );
    } else {
      parts.push(`${formatINR(flexible)} starter allowance`);
    }
  }
  return parts.length > 0 ? parts.join(" + ") : "No spending planned here";
}
