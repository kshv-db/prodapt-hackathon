import type { Category, ExpenseSource, PersonaId } from "@/lib/finance/categories";
import type { SpendAggregates } from "@/lib/finance/aggregate";
import type { CategoryAverage } from "@/lib/finance/goals";

/** Row shapes mirror the PRD data model (section 7). */
export interface FixedCostRow {
  name: string;
  amount: number;
  category?: Category;
}

export interface Profile {
  id: string;
  name: string | null;
  monthly_income: number;
  fixed_costs: FixedCostRow[];
  persona: PersonaId;
  created_at: string;
}

export interface Expense {
  id: string;
  user_id: string;
  amount: number;
  category: Category;
  merchant: string;
  note: string | null;
  spent_on: string;
  spent_at: string | null;
  source: ExpenseSource;
  created_at: string;
}

export interface NewExpense {
  amount: number;
  category: Category;
  merchant: string;
  note?: string | null;
  spent_on: string;
  spent_at?: string | null;
  source: ExpenseSource;
}

export interface BudgetRow {
  id: string;
  user_id: string;
  month: string; // YYYY-MM-01
  category: Category;
  limit_amount: number;
  reason: string | null;
}

export interface BudgetInputRow {
  category: Category;
  limit: number;
  reason?: string | null;
}

export interface Goal {
  id: string;
  user_id: string;
  title: string;
  target_amount: number;
  saved_amount: number;
  deadline: string;
  created_at: string;
}

export interface NewGoal {
  title: string;
  target_amount: number;
  saved_amount?: number;
  deadline: string;
}

export interface Insight {
  id: string;
  user_id: string;
  kind: string;
  body: string;
  created_at: string;
}

export interface ChatMessage {
  id: string;
  user_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export interface ProfileUpdate {
  name?: string | null;
  monthly_income?: number;
  fixed_costs?: FixedCostRow[];
  persona?: PersonaId;
}

export interface SeedPayload {
  profile: { name: string; monthly_income: number; fixed_costs: FixedCostRow[]; persona: PersonaId };
  expenses: NewExpense[];
  budgetMonth: string; // YYYY-MM-01
  budgets: { category: Category; limit: number; reason: string }[];
  goals: NewGoal[];
}

/**
 * Data access for ONE authenticated user. Every method is implicitly scoped to that user:
 * the Supabase implementation relies on RLS (user-scoped client, no service role), the test
 * implementation filters by user id. No method accepts a user id as input.
 */
export interface Store {
  readonly userId: string;

  getProfile(): Promise<Profile | null>;
  upsertProfile(update: ProfileUpdate): Promise<Profile>;

  listExpenses(month: string): Promise<Expense[]>;
  listRecentExpenses(limit: number): Promise<Expense[]>;
  insertExpense(expense: NewExpense): Promise<Expense>;
  /** Returns false when nothing was deleted (not found or not owned). */
  deleteExpense(id: string): Promise<boolean>;
  getSpendAggregates(month: string): Promise<SpendAggregates>;
  getCategoryAverages(currentMonth: string): Promise<CategoryAverage[]>;

  listBudgets(month: string): Promise<BudgetRow[]>;
  replaceBudgets(month: string, rows: readonly BudgetInputRow[]): Promise<BudgetRow[]>;

  listGoals(): Promise<Goal[]>;
  getGoal(id: string): Promise<Goal | null>;
  insertGoal(goal: NewGoal): Promise<Goal>;
  /** Atomic increment. Null when the goal does not exist / is not owned. */
  contributeToGoal(id: string, amount: number): Promise<Goal | null>;

  insertInsight(kind: string, body: string): Promise<Insight>;
  latestInsight(kind?: string): Promise<Insight | null>;

  listChat(limit: number): Promise<ChatMessage[]>; // oldest -> newest
  insertChat(role: "user" | "assistant", content: string): Promise<ChatMessage>;

  /** Idempotent: returns false (and inserts nothing) if seed data already exists. */
  seedDemo(payload: SeedPayload): Promise<boolean>;
}
