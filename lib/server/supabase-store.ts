import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { AppError } from "@/lib/errors";
import type { SpendAggregates } from "@/lib/finance/aggregate";
import { DISCRETIONARY_CATEGORIES, LATE_NIGHT_FROM, LATE_NIGHT_UNTIL } from "@/lib/finance/categories";
import { monthStart, nextMonthStart } from "@/lib/finance/dates";
import type { CategoryAverage } from "@/lib/finance/goals";
import type {
  BudgetInputRow,
  BudgetRow,
  ChatMessage,
  Expense,
  Goal,
  Insight,
  NewExpense,
  NewGoal,
  Profile,
  ProfileUpdate,
  Store,
} from "./store";

/** Translate a PostgREST error into a safe AppError. Raw DB details are logged, never returned. */
export function dbError(error: PostgrestError, action: string): AppError {
  console.error(`[db] ${action} failed: code=${error.code} message=${error.message}`);
  if (error.code === "23505") return new AppError(409, "Resource already exists");
  if (error.code === "42501") return new AppError(403, "Forbidden");
  if (error.code === "23514" || error.code === "22P02" || error.code === "23502") return new AppError(400, "Invalid data");
  return new AppError(500, "Database error");
}

const num = (v: unknown): number => Number(v);

// expenses.merchant is nullable in the canonical schema; the API always exposes a string.
const toExpense = (r: Expense): Expense => ({ ...r, amount: num(r.amount), merchant: r.merchant ?? "" });
const toGoal = (r: Goal): Goal => ({ ...r, target_amount: num(r.target_amount), saved_amount: num(r.saved_amount) });
const toBudget = (r: BudgetRow): BudgetRow => ({ ...r, limit_amount: num(r.limit_amount) });
const toProfile = (r: Profile): Profile => ({ ...r, monthly_income: num(r.monthly_income) });

export class SupabaseStore implements Store {
  constructor(
    private readonly db: SupabaseClient,
    readonly userId: string,
  ) {}

  async getProfile(): Promise<Profile | null> {
    const { data, error } = await this.db.from("profiles").select("*").eq("id", this.userId).maybeSingle();
    if (error) throw dbError(error, "getProfile");
    return data ? toProfile(data as Profile) : null;
  }

  async upsertProfile(update: ProfileUpdate): Promise<Profile> {
    // profiles.name is NOT NULL, so an INSERT-based upsert would fail on partial updates. Insert or update explicitly.
    const existing = await this.getProfile();
    const query = existing
      ? this.db.from("profiles").update(update).eq("id", this.userId)
      : this.db.from("profiles").insert({ id: this.userId, name: "", ...update });
    const { data, error } = await query.select("*").single();
    if (error) throw dbError(error, "upsertProfile");
    return toProfile(data as Profile);
  }

  async listExpenses(month: string): Promise<Expense[]> {
    const { data, error } = await this.db
      .from("expenses")
      .select("*")
      .gte("spent_on", monthStart(month))
      .lt("spent_on", nextMonthStart(month))
      .order("spent_on", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw dbError(error, "listExpenses");
    return (data as Expense[]).map(toExpense);
  }

  async listRecentExpenses(limit: number): Promise<Expense[]> {
    const { data, error } = await this.db
      .from("expenses")
      .select("*")
      .order("spent_on", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw dbError(error, "listRecentExpenses");
    return (data as Expense[]).map(toExpense);
  }

  async insertExpense(e: NewExpense): Promise<Expense> {
    const { data, error } = await this.db
      .from("expenses")
      .insert({ ...e, user_id: this.userId, note: e.note ?? null, spent_at: e.spent_at ?? null })
      .select("*")
      .single();
    if (error) throw dbError(error, "insertExpense");
    return toExpense(data as Expense);
  }

  async deleteExpense(id: string): Promise<boolean> {
    const { data, error } = await this.db.from("expenses").delete().eq("id", id).select("id");
    if (error) throw dbError(error, "deleteExpense");
    return (data?.length ?? 0) > 0;
  }

  async getSpendAggregates(month: string): Promise<SpendAggregates> {
    const { data, error } = await this.db.rpc("spend_aggregates", {
      p_month: monthStart(month),
      p_discretionary: [...DISCRETIONARY_CATEGORIES],
      p_late_from: LATE_NIGHT_FROM,
      p_late_until: LATE_NIGHT_UNTIL,
    });
    if (error) throw dbError(error, "spend_aggregates");
    const r = data as Record<string, unknown>;
    const rows = <T>(v: unknown) => (Array.isArray(v) ? (v as T[]) : []);
    return {
      month,
      total: num(r.total),
      count: num(r.count),
      byCategory: rows<{ category: string; total: unknown }>(r.byCategory).map((c) => ({ category: c.category, total: num(c.total) })),
      topMerchants: rows<{ merchant: string; total: unknown; count: unknown }>(r.topMerchants).map((m) => ({
        merchant: m.merchant,
        total: num(m.total),
        count: num(m.count),
      })),
      trend: rows<{ month: string; total: unknown; count: unknown }>(r.trend).map((t) => ({
        month: t.month,
        total: num(t.total),
        count: num(t.count),
      })),
      discretionaryTotal: num(r.discretionaryTotal),
      lateNightDiscretionary: num(r.lateNightDiscretionary),
    };
  }

  async getCategoryAverages(currentMonth: string): Promise<CategoryAverage[]> {
    const { data, error } = await this.db.rpc("category_averages", { p_month: monthStart(currentMonth), p_months: 3 });
    if (error) throw dbError(error, "category_averages");
    return (data as { category: string; avg: unknown }[]).map((r) => ({ category: r.category, avg: num(r.avg) }));
  }

  async listBudgets(month: string): Promise<BudgetRow[]> {
    const { data, error } = await this.db.from("budgets").select("*").eq("month", monthStart(month)).order("category");
    if (error) throw dbError(error, "listBudgets");
    return (data as BudgetRow[]).map(toBudget);
  }

  async replaceBudgets(month: string, rows: readonly BudgetInputRow[]): Promise<BudgetRow[]> {
    const { data, error } = await this.db.rpc("replace_budgets", {
      p_month: monthStart(month),
      p_rows: rows.map((r) => ({ category: r.category, limit: r.limit, reason: r.reason ?? null })),
    });
    if (error) throw dbError(error, "replace_budgets");
    return (data as BudgetRow[]).map(toBudget).sort((a, b) => a.category.localeCompare(b.category));
  }

  async listGoals(): Promise<Goal[]> {
    const { data, error } = await this.db.from("goals").select("*").order("created_at", { ascending: true });
    if (error) throw dbError(error, "listGoals");
    return (data as Goal[]).map(toGoal);
  }

  async getGoal(id: string): Promise<Goal | null> {
    const { data, error } = await this.db.from("goals").select("*").eq("id", id).maybeSingle();
    if (error) throw dbError(error, "getGoal");
    return data ? toGoal(data as Goal) : null;
  }

  async insertGoal(g: NewGoal): Promise<Goal> {
    const { data, error } = await this.db
      .from("goals")
      .insert({ ...g, user_id: this.userId, saved_amount: g.saved_amount ?? 0 })
      .select("*")
      .single();
    if (error) throw dbError(error, "insertGoal");
    return toGoal(data as Goal);
  }

  async contributeToGoal(id: string, amount: number): Promise<Goal | null> {
    const { data, error } = await this.db.rpc("contribute_to_goal", { p_goal_id: id, p_amount: amount });
    if (error) throw dbError(error, "contribute_to_goal");
    const row = (data as Goal[])[0];
    return row ? toGoal(row) : null;
  }

  async insertInsight(kind: string, body: string): Promise<Insight> {
    const { data, error } = await this.db
      .from("insights")
      .insert({ user_id: this.userId, kind, body })
      .select("*")
      .single();
    if (error) throw dbError(error, "insertInsight");
    return data as Insight;
  }

  async latestInsight(kind?: string): Promise<Insight | null> {
    let q = this.db.from("insights").select("*").order("created_at", { ascending: false }).limit(1);
    if (kind) q = q.eq("kind", kind);
    const { data, error } = await q.maybeSingle();
    if (error) throw dbError(error, "latestInsight");
    return (data as Insight) ?? null;
  }

  async listChat(limit: number): Promise<ChatMessage[]> {
    const { data, error } = await this.db
      .from("chat_messages")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw dbError(error, "listChat");
    return (data as ChatMessage[]).reverse();
  }

  async insertChat(role: "user" | "assistant", content: string): Promise<ChatMessage> {
    const { data, error } = await this.db
      .from("chat_messages")
      .insert({ user_id: this.userId, role, content })
      .select("*")
      .single();
    if (error) throw dbError(error, "insertChat");
    return data as ChatMessage;
  }

  async seedDemo(): Promise<void> {
    const { error } = await this.db.rpc("seed_demo_data");
    if (error) throw dbError(error, "seed_demo_data");
  }
}
