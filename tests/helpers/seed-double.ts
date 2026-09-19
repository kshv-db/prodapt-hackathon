import { aggregateSpend } from "@/lib/finance/aggregate";
import { addDays, addMonths, addMonthsClamped, daysBetween, monthOf, monthStart } from "@/lib/finance/dates";
import { calculateSavingsBaseline } from "@/lib/finance/savings";
import { generateBudget } from "@/lib/finance/budget";
import type { Category } from "@/lib/finance/categories";
import type { NewExpense, NewGoal, FixedCostRow } from "@/lib/server/store";

/** TEST DOUBLE ONLY. Production seeding is the canonical SQL function seed_demo_data() (feature/db). This
 * deterministic generator lets route-level tests exercise a demo dataset whose laptop goal is off track. */
export interface SeedPayload {
  profile: { name: string; monthly_income: number; fixed_costs: FixedCostRow[]; persona: "friendly" };
  expenses: NewExpense[];
  budgetMonth: string;
  budgets: { category: Category; limit: number; reason: string }[];
  goals: NewGoal[];
}

/** Demo persona: "Meera" - first job, rent + EMI leave little slack, heavy late-night food orders. */
export const DEMO_INCOME = 45_000;
export const DEMO_FIXED_COSTS = [
  { label: "Rent", amount: 12_000, category: "Rent & EMI" as Category },
  { label: "Phone EMI", amount: 2_000, category: "Rent & EMI" as Category },
  { label: "Wifi + electricity", amount: 1_800, category: "Bills & Utilities" as Category },
];

interface Template {
  merchant: string;
  category: Category;
  amount: number;
  /** Day of month the payment usually happens (fixed items). */
  day?: number;
  spent_at?: string;
}

const FIXED: Template[] = [
  { merchant: "Landlord", category: "Rent & EMI", amount: 12_000, day: 1 },
  { merchant: "Phone EMI", category: "Rent & EMI", amount: 2_000, day: 3 },
  { merchant: "Airtel Wifi", category: "Bills & Utilities", amount: 1_100, day: 5 },
  { merchant: "Electricity Board", category: "Bills & Utilities", amount: 700, day: 8 },
  { merchant: "Netflix", category: "Subscriptions", amount: 649, day: 10 },
  { merchant: "Spotify", category: "Subscriptions", amount: 119, day: 12 },
];

/** Small deterministic PRNG so demo data is identical every time for a given date. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round10 = (n: number) => Math.round(n / 10) * 10;

function monthExpenses(month: string, today: string, scale: number, rand: () => number): NewExpense[] {
  const first = monthStart(month);
  const lastDayOfMonth = addDays(monthStart(addMonths(month, 1)), -1);
  const end = monthOf(today) === month ? today : lastDayOfMonth;
  const span = daysBetween(first, end) + 1;
  const dayDate = (day: number) => addDays(first, Math.min(day, span) - 1);
  const out: NewExpense[] = [];
  const push = (t: Template, date: string, amount: number, exact = false) => {
    if (date > end || amount <= 0) return;
    out.push({
      amount: exact ? Math.round(amount * scale) : Math.max(10, round10(amount * scale)),
      category: t.category,
      merchant: t.merchant,
      spent_on: date,
      spent_at: t.spent_at ?? null,
      source: "seed",
    });
  };
  const pick = (n: number) => Math.floor(rand() * n);
  const jitter = (base: number, pct: number) => base * (1 + (rand() * 2 - 1) * pct);

  for (const t of FIXED) push(t, dayDate(t.day ?? 1), t.amount, true);

  // Groceries: weekly-ish
  for (let d = 2; d <= span; d += 7) push({ merchant: pick(2) ? "BigBasket" : "Blinkit", category: "Groceries", amount: 0 }, dayDate(d), jitter(1000, 0.25));
  // Transport
  for (let i = 0; i < 8; i++) push({ merchant: pick(2) ? "Uber" : "Ola", category: "Transport", amount: 0 }, dayDate(1 + pick(span)), jitter(220, 0.4));
  // Day-time food (a few)
  for (let i = 0; i < 4; i++) push({ merchant: pick(2) ? "Cafe Coffee Day" : "Domino's", category: "Food & Dining", amount: 0, spent_at: "13:15" }, dayDate(1 + pick(span)), jitter(330, 0.3));
  // The deliberate pattern: heavy LATE-NIGHT food delivery (11pm-1:30am)
  const lateOrders = 13;
  for (let i = 0; i < lateOrders; i++) {
    const hour = ["23:20", "23:45", "00:10", "00:35", "01:05", "23:30"][i % 6] ?? "23:30";
    push({ merchant: i % 3 === 0 ? "Swiggy" : "Zomato", category: "Food & Dining", amount: 0, spent_at: hour }, dayDate(1 + Math.floor((i * span) / lateOrders)), jitter(430, 0.15));
  }
  push({ merchant: "Amazon", category: "Shopping", amount: 0 }, dayDate(9 + pick(6)), jitter(1500, 0.3));
  push({ merchant: "Myntra", category: "Shopping", amount: 0 }, dayDate(17 + pick(6)), jitter(1200, 0.3));
  push({ merchant: "BookMyShow", category: "Entertainment", amount: 0 }, dayDate(14 + pick(8)), jitter(600, 0.2));
  push({ merchant: "Apollo Pharmacy", category: "Health", amount: 0 }, dayDate(6 + pick(15)), jitter(500, 0.3));
  return out;
}

/**
 * Builds 3 completed months + the current month-to-date of realistic transactions, a budget for the
 * current month, two goals (laptop = deliberately off track, bike = on track) and a late-night food pattern.
 * Amounts scale with the user's income so numbers stay believable for any income.
 */
export function buildSeedPayload(today: string, opts: { income?: number; name?: string } = {}): SeedPayload {
  const income = opts.income && opts.income > 0 ? opts.income : DEMO_INCOME;
  const scale = income / DEMO_INCOME;
  const month = monthOf(today);
  const rand = mulberry32(Number(today.replace(/-/g, "")) % 100_000);

  const expenses = [-3, -2, -1, 0].flatMap((delta) => monthExpenses(addMonths(month, delta), today, scale, rand));

  const fixedCosts = DEMO_FIXED_COSTS.map((f) => ({ ...f, amount: Math.round(f.amount * scale) }));
  const generated = generateBudget({
    income,
    fixedCosts,
    history: averagesFrom(expenses, month),
  });

  // Laptop goal is deliberately OFF track: it needs ~INR 1,800/month more than the user currently saves,
  // so the demo always has a concrete cut to show (computed from the generated data, not hard-coded).
  const like = expenses.map((e) => ({ ...e, merchant: e.merchant, spent_at: e.spent_at ?? null }));
  const baseline = calculateSavingsBaseline(aggregateSpend(like, month).trend, income, month);
  const laptopSaved = round10(18_000 * scale);
  const laptopMonths = 4;
  const laptopTarget = round10(laptopSaved + laptopMonths * (baseline.avgMonthlySavings + 1_800 * scale));

  return {
    profile: { name: opts.name ?? "Meera", monthly_income: income, fixed_costs: fixedCosts, persona: "friendly" },
    expenses,
    budgetMonth: monthStart(month),
    budgets: generated.budgets.filter((b) => b.limit > 0).map((b) => ({ category: b.category, limit: b.limit, reason: b.reason })),
    goals: [
      { title: "New laptop", target_amount: laptopTarget, saved_amount: laptopSaved, deadline: addMonthsClamped(today, laptopMonths) },
      { title: "Bike down payment", target_amount: round10(90_000 * scale), saved_amount: round10(20_000 * scale), deadline: addDays(today, 730) },
    ],
  };
}

function averagesFrom(expenses: readonly NewExpense[], currentMonth: string) {
  const start = addMonths(currentMonth, -3);
  const rows = expenses.filter((e) => monthOf(e.spent_on) >= start && monthOf(e.spent_on) < currentMonth);
  const months = new Set(rows.map((r) => monthOf(r.spent_on))).size || 1;
  const sums = new Map<string, number>();
  for (const r of rows) sums.set(r.category, (sums.get(r.category) ?? 0) + r.amount);
  return [...sums.entries()].map(([category, total]) => ({ category, avg: total / months }));
}
