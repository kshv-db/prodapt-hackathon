import { randomUUID } from "node:crypto";
import { aggregateSpend, calculateCategoryAverages, type SpendAggregates } from "@/lib/finance/aggregate";
import { monthOf, monthStart, nextMonthStart } from "@/lib/finance/dates";
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
  SeedPayload,
  Store,
} from "@/lib/server/store";

/** Shared in-memory "database". Each user gets a Store scoped to their id, mimicking RLS. */
export class MemoryDb {
  profiles = new Map<string, Profile>();
  expenses: Expense[] = [];
  budgets: BudgetRow[] = [];
  goals: Goal[] = [];
  insights: Insight[] = [];
  chat: ChatMessage[] = [];
  private clock = Date.parse("2026-09-01T00:00:00Z");
  tick = () => new Date((this.clock += 1000)).toISOString();

  forUser(userId: string): Store {
    return new MemoryStore(this, userId);
  }
}

class MemoryStore implements Store {
  constructor(
    private readonly db: MemoryDb,
    readonly userId: string,
  ) {}

  private mine<T extends { user_id: string }>(rows: T[]): T[] {
    return rows.filter((r) => r.user_id === this.userId);
  }

  async getProfile() {
    return this.db.profiles.get(this.userId) ?? null;
  }

  async upsertProfile(update: ProfileUpdate): Promise<Profile> {
    const existing = this.db.profiles.get(this.userId);
    const next: Profile = {
      id: this.userId,
      name: null,
      monthly_income: 0,
      fixed_costs: [],
      persona: "friendly",
      created_at: this.db.tick(),
      ...existing,
      ...update,
    };
    this.db.profiles.set(this.userId, next);
    return next;
  }

  async listExpenses(month: string) {
    return this.mine(this.db.expenses)
      .filter((e) => e.spent_on >= monthStart(month) && e.spent_on < nextMonthStart(month))
      .sort((a, b) => b.spent_on.localeCompare(a.spent_on) || b.created_at.localeCompare(a.created_at));
  }

  async listRecentExpenses(limit: number) {
    return this.mine(this.db.expenses)
      .sort((a, b) => b.spent_on.localeCompare(a.spent_on) || b.created_at.localeCompare(a.created_at))
      .slice(0, limit);
  }

  async insertExpense(e: NewExpense): Promise<Expense> {
    const row: Expense = { id: randomUUID(), user_id: this.userId, note: null, spent_at: null, ...e, created_at: this.db.tick() } as Expense;
    row.note = e.note ?? null;
    row.spent_at = e.spent_at ?? null;
    this.db.expenses.push(row);
    return row;
  }

  async deleteExpense(id: string) {
    const before = this.db.expenses.length;
    this.db.expenses = this.db.expenses.filter((e) => !(e.id === id && e.user_id === this.userId));
    return this.db.expenses.length < before;
  }

  async getSpendAggregates(month: string): Promise<SpendAggregates> {
    return aggregateSpend(this.mine(this.db.expenses), month);
  }

  async getCategoryAverages(currentMonth: string): Promise<CategoryAverage[]> {
    return calculateCategoryAverages(this.mine(this.db.expenses), currentMonth);
  }

  async listBudgets(month: string) {
    return this.mine(this.db.budgets)
      .filter((b) => b.month === monthStart(month))
      .sort((a, b) => a.category.localeCompare(b.category));
  }

  async replaceBudgets(month: string, rows: readonly BudgetInputRow[]) {
    const m = monthStart(month);
    this.db.budgets = this.db.budgets.filter((b) => !(b.user_id === this.userId && b.month === m));
    for (const r of rows) {
      this.db.budgets.push({ id: randomUUID(), user_id: this.userId, month: m, category: r.category, limit_amount: r.limit, reason: r.reason ?? null });
    }
    return this.listBudgets(month);
  }

  async listGoals() {
    return this.mine(this.db.goals).sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  async getGoal(id: string) {
    return this.mine(this.db.goals).find((g) => g.id === id) ?? null;
  }

  async insertGoal(g: NewGoal): Promise<Goal> {
    const row: Goal = { id: randomUUID(), user_id: this.userId, saved_amount: 0, ...g, created_at: this.db.tick() } as Goal;
    this.db.goals.push(row);
    return row;
  }

  async contributeToGoal(id: string, amount: number) {
    const goal = await this.getGoal(id);
    if (!goal) return null;
    goal.saved_amount = Math.round((goal.saved_amount + amount) * 100) / 100;
    return goal;
  }

  async insertInsight(kind: string, body: string): Promise<Insight> {
    const row: Insight = { id: randomUUID(), user_id: this.userId, kind, body, created_at: this.db.tick() };
    this.db.insights.push(row);
    return row;
  }

  async latestInsight(kind?: string) {
    const rows = this.mine(this.db.insights).filter((i) => !kind || i.kind === kind);
    return rows.at(-1) ?? null;
  }

  async listChat(limit: number) {
    return this.mine(this.db.chat).slice(-limit);
  }

  async insertChat(role: "user" | "assistant", content: string): Promise<ChatMessage> {
    const row: ChatMessage = { id: randomUUID(), user_id: this.userId, role, content, created_at: this.db.tick() };
    this.db.chat.push(row);
    return row;
  }

  async seedDemo(p: SeedPayload) {
    if (this.mine(this.db.expenses).some((e) => e.source === "seed")) return false;
    const existing = this.db.profiles.get(this.userId);
    await this.upsertProfile({
      name: existing?.name ?? p.profile.name,
      monthly_income: existing && existing.monthly_income > 0 ? existing.monthly_income : p.profile.monthly_income,
      fixed_costs: existing && existing.fixed_costs.length > 0 ? existing.fixed_costs : p.profile.fixed_costs,
    });
    for (const e of p.expenses) await this.insertExpense(e);
    for (const b of p.budgets) {
      if (!this.db.budgets.some((x) => x.user_id === this.userId && x.month === p.budgetMonth && x.category === b.category)) {
        this.db.budgets.push({ id: randomUUID(), user_id: this.userId, month: p.budgetMonth, category: b.category, limit_amount: b.limit, reason: b.reason });
      }
    }
    for (const g of p.goals) await this.insertGoal(g);
    return true;
  }
}

export const monthKey = monthOf;
