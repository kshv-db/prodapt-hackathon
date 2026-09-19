import type { FactSheet, ProjectionFacts, ToolExecutors } from "./types";

/** Shared test data for the AI layer. Never imported by app code. */
export const TODAY = "2026-09-19"; // Saturday

export function makeFacts(over: Partial<FactSheet> = {}): FactSheet {
  return {
    asOf: TODAY,
    month: "2026-09",
    currency: "INR",
    profile: { name: "Aarav", monthlyIncome: 15000, persona: "friendly", language: "hinglish" },
    totals: { spent: 9820, saved: 5180, savingsRatePct: 35 },
    byCategory: [
      { category: "Food & Dining", spent: 4920, limit: 6000, usedPct: 82, prevMonthSpent: 4100 },
      { category: "Transport", spent: 1420, limit: 1800, usedPct: 79, prevMonthSpent: 1300 },
    ],
    trend: [{ month: "2026-09", spent: 9820 }],
    topMerchants: [{ merchant: "Zomato", spent: 2140, count: 9 }],
    budget: { totalLimit: 12000, overCategories: [], nearLimitCategories: ["Food & Dining"] },
    goals: [
      {
        id: "g1",
        title: "Laptop",
        target: 60000,
        saved: 18000,
        deadline: "2027-03-31",
        monthlyNeeded: 7000,
        onTrack: false,
        gapPerMonth: 1800,
      },
    ],
    patterns: { lateNightCount7d: 3, lateNightSpend7d: 1450, lateNightSpendPct: 15 },
    health: { score: 68, reason: "Late-night orders are hurting you." },
    ...over,
  };
}

export const PROJECTION: ProjectionFacts = {
  years: 5,
  annualReturnPct: 7,
  current: { monthlySaving: 1800, endBalance: 128000 },
  chosen: { monthlySaving: 5000, endBalance: 358000 },
  difference: 230000,
  goal: { title: "Laptop", target: 60000, monthsCurrent: 30, monthsChosen: 11 },
};

/** Records every executor call so tests can assert what the agent did. */
export function makeTools() {
  const calls: { fn: string; userId: string; args: unknown }[] = [];
  const tools: ToolExecutors = {
    async get_spending_summary(userId, args) {
      calls.push({ fn: "get_spending_summary", userId, args });
      return { total: 9820, top_category: "Food & Dining" };
    },
    async get_budget_status(userId, args) {
      calls.push({ fn: "get_budget_status", userId, args });
      return { food_used_pct: 82, food_limit: 6000 };
    },
    async get_goals(userId) {
      calls.push({ fn: "get_goals", userId, args: {} });
      return { goals: [] };
    },
    async run_projection(userId, args) {
      calls.push({ fn: "run_projection", userId, args });
      return PROJECTION;
    },
    async list_recent_expenses(userId, args) {
      calls.push({ fn: "list_recent_expenses", userId, args });
      return {
        expenses: [{ id: "11111111-1111-4111-8111-111111111111", date: "2026-09-18", amount: 450, category: "Food & Dining", merchant: "Zomato" }],
      };
    },
    async run_what_if(userId, args) {
      calls.push({ fn: "run_what_if", userId, args });
      return {
        budgetImpact: { totalCost: 30000, averageSavingBefore: 1800, averageSavingAfter: 0 },
        goalDelays: [{ title: "Laptop", delayMonths: 8 }],
      };
    },
    async suggest_savings(userId) {
      calls.push({ fn: "suggest_savings", userId, args: {} });
      return { suggestions: [{ category: "Food & Dining", spent: 4920, potentialSaving: 750 }] };
    },
    async set_persona(userId, persona) {
      calls.push({ fn: "set_persona", userId, args: { persona } });
      return { persona };
    },
    async add_expense(userId, args) {
      calls.push({ fn: "add_expense", userId, args });
      return { expenseId: `exp-${calls.length}` };
    },
    async propose_action(userId, tool, args) {
      calls.push({ fn: `propose:${tool}`, userId, args });
      return { actionId: "act-1", summary: `Change ${JSON.stringify(args)}` };
    },
  };
  return { tools, calls };
}
