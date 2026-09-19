import type { Category } from "@/lib/finance/constants";
import type { Persona } from "./personas";

export type Language = "en" | "hinglish";

/**
 * Built by the backend from the DB using /lib/finance. The AI layer only reads it.
 * Shared contract: see docs/FutureWallet-AI-Contract.md.
 */
export interface FactSheet {
  asOf: string; // YYYY-MM-DD, today in IST
  month: string; // YYYY-MM
  currency: "INR";
  profile: { name: string; monthlyIncome: number; persona: Persona; language: Language };
  totals: { spent: number; saved: number; savingsRatePct: number };
  byCategory: {
    category: Category;
    spent: number;
    limit: number | null;
    usedPct: number | null;
    prevMonthSpent: number | null;
  }[];
  trend: { month: string; spent: number }[];
  topMerchants: { merchant: string; spent: number; count: number }[];
  budget: { totalLimit: number; overCategories: Category[]; nearLimitCategories: Category[] };
  goals: {
    id: string;
    title: string;
    target: number;
    saved: number;
    deadline: string;
    monthlyNeeded: number;
    onTrack: boolean;
    gapPerMonth: number;
  }[];
  patterns: { lateNightCount7d: number; lateNightSpend7d: number; lateNightSpendPct: number };
  health: { score: number; reason: string };
}

/** Computed by /lib/finance and passed in for the Future You narrative. */
export interface ProjectionFacts {
  years: number;
  annualReturnPct: number;
  current: { monthlySaving: number; endBalance: number };
  chosen: { monthlySaving: number; endBalance: number };
  difference: number;
  goal?: { title: string; target: number; monthsCurrent: number | null; monthsChosen: number | null };
}

/** Detected by code (/lib/finance). The AI only phrases it. */
export interface NudgeTrigger {
  kind: "budget_80" | "late_night" | "goal_off_track" | "weekly_recap";
  /** Plain sentence built by code from the facts; also the fallback text. */
  summary: string;
  facts: Record<string, string | number>;
}

/** Events streamed by POST /api/agent/chat as server-sent events. */
export type AgentEvent =
  | { type: "step"; id: string; tool: string; label: string; status: "running" | "done" | "error" }
  | { type: "token"; text: string }
  | { type: "confirm"; actionId: string; tool: string; summary: string; args: Record<string, unknown> }
  | { type: "undo"; expenseId: string; label: string }
  | { type: "ui"; component: "future_chart" | "spending_chart"; props: Record<string, unknown> }
  | { type: "sources"; facts: { label: string; value: string }[] }
  | { type: "mood"; mood: "idle" | "thinking" | "happy" | "worried" | "smirk" | "celebrating" }
  | { type: "done" }
  | { type: "error"; message: string };

export type AddExpenseArgs = {
  amount: number;
  category: Category;
  merchant?: string;
  spent_on: string;
  note?: string;
};

export type ProposableTool =
  | "update_budget"
  | "create_goal"
  | "contribute_to_goal"
  | "delete_expense"
  | "generate_budget";

/**
 * Implemented by the backend. `userId` always comes from the session and is never a model argument.
 * Read executors return computed data (numbers come from code). Writes go through the backend's own validation.
 */
export interface ToolExecutors {
  get_spending_summary(userId: string, a: { month?: string; category?: Category }): Promise<unknown>;
  get_budget_status(userId: string, a: { month?: string }): Promise<unknown>;
  get_goals(userId: string): Promise<unknown>;
  run_projection(userId: string, a: { monthlySaving: number; years: number }): Promise<ProjectionFacts>;
  /** Newest first. Rows carry the id that delete_expense needs. */
  list_recent_expenses(userId: string, a: { limit?: number; category?: Category; month?: string }): Promise<unknown>;
  /** Pre-spend check: effect of a purchase or EMI on monthly saving and goal dates. Computed by code. */
  run_what_if(userId: string, a: { description: string; monthlyCost: number; months: number }): Promise<unknown>;
  /** Concrete, code-computed places to cut. */
  suggest_savings(userId: string): Promise<unknown>;
  /** Immediate and harmless: changes the advisor's voice. */
  set_persona(userId: string, persona: Persona): Promise<{ persona: Persona }>;
  add_expense(userId: string, a: AddExpenseArgs): Promise<{ expenseId: string }>;
  /** Stores a pending action; it runs only after POST /api/agent/confirm. */
  propose_action(
    userId: string,
    tool: ProposableTool,
    args: Record<string, unknown>,
  ): Promise<{ actionId: string; summary: string }>;
}
