import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { aggregateSpend, calculateCategoryAverages, type ExpenseLike } from "@/lib/finance/aggregate";
import { DISCRETIONARY_CATEGORIES, LATE_NIGHT_FROM, LATE_NIGHT_UNTIL, isLateNight } from "@/lib/finance/categories";
import { USER_A, USER_B, asUser, createDb } from "./pg";

let db: PGlite;
let month: string; // YYYY-MM of the database's current_date (the canonical seed is relative to it)
const num = (v: unknown) => Number(v);

const seed = (uid: string) => asUser(db, uid, async () => (await db.query<{ r: Record<string, unknown> }>(`select seed_demo_data() r`)).rows[0]!.r);
const rowsOf = (uid: string, sql: string, params: unknown[] = []) => asUser(db, uid, async () => (await db.query<Record<string, any>>(sql, params)).rows); // eslint-disable-line @typescript-eslint/no-explicit-any

beforeAll(async () => {
  db = await createDb();
  month = (await db.query<{ m: string }>(`select to_char(current_date, 'YYYY-MM') m`)).rows[0]!.m;
  await asUser(db, USER_A, () => db.query(`insert into profiles (id, name, monthly_income) values ($1, 'A', 45000)`, [USER_A]));
});
afterAll(async () => db.close());

describe("canonical seed_demo_data() as used by POST /api/demo/seed", () => {
  it("refuses to run without a profile (never invents one)", async () => {
    await expect(seed(USER_B)).rejects.toThrow(/No profile/);
  });

  it("seeds 3 months, a budget, 2 goals and a late-night food pattern for the caller only", async () => {
    const res = await seed(USER_A);
    expect(res).toMatchObject({ seeded_for: USER_A, goals_inserted: 2 });
    const months = await rowsOf(USER_A, `select distinct to_char(spent_on, 'YYYY-MM') m from expenses order by 1`);
    expect(months).toHaveLength(3);
    expect(months.at(-1)!.m).toBe(month);
    expect(await rowsOf(USER_A, `select 1 from expenses where source <> 'seed'`)).toHaveLength(0);
    expect((await rowsOf(USER_A, `select 1 from goals`)).length).toBe(2);
    expect((await rowsOf(USER_A, `select 1 from budgets where month = $1`, [`${month}-01`])).length).toBeGreaterThan(5);
    const late = await rowsOf(USER_A, `select spent_at::text t from expenses where note = 'Late-night order'`);
    expect(late.length).toBeGreaterThanOrEqual(9);
    expect(late.every((r) => isLateNight(r.t))).toBe(true);
    expect(await rowsOf(USER_B, `select 1 from expenses`)).toHaveLength(0);
  });

  it("is idempotent: re-running replaces the seed rows and keeps manual expenses", async () => {
    await asUser(db, USER_A, () => db.query(`insert into expenses (user_id, amount, category, merchant, spent_on, source) values ($1, 111, 'Other', 'mine', current_date, 'manual')`, [USER_A]));
    const goals = (await rowsOf(USER_A, `select count(*) n from goals`))[0]!.n;
    const budgets = (await rowsOf(USER_A, `select count(*) n from budgets`))[0]!.n;
    await seed(USER_A);
    await seed(USER_A);
    expect(num((await rowsOf(USER_A, `select count(*) n from goals`))[0]!.n)).toBe(num(goals));
    expect(num((await rowsOf(USER_A, `select count(*) n from budgets`))[0]!.n)).toBe(num(budgets));
    expect(num((await rowsOf(USER_A, `select count(*) n from expenses where merchant = 'mine'`))[0]!.n)).toBe(1);
    expect((await rowsOf(USER_A, `select distinct to_char(spent_on, 'YYYY-MM') m from expenses where source = 'seed'`))).toHaveLength(3);
  });
});

describe("backend SQL aggregates match the TypeScript reference on the seeded data", () => {
  const like = async (): Promise<ExpenseLike[]> =>
    (await rowsOf(USER_A, `select amount, category::text category, merchant, spent_on::text spent_on, spent_at::text spent_at from expenses`)).map((r) => ({
      amount: num(r.amount), category: r.category, merchant: r.merchant, spent_on: r.spent_on, spent_at: r.spent_at,
    }));

  it("spend_aggregates == aggregateSpend (total, categories, merchants, 6-month trend, late-night)", async () => {
    const sql = (await rowsOf(USER_A, `select spend_aggregates($1::date, $2::text[], $3::time, $4::time) r`, [`${month}-01`, [...DISCRETIONARY_CATEGORIES], LATE_NIGHT_FROM, LATE_NIGHT_UNTIL]))[0]!.r;
    const ts = aggregateSpend(await like(), month);
    expect(num(sql.total)).toBe(ts.total);
    expect(num(sql.count)).toBe(ts.count);
    expect(sql.byCategory.map((c: { category: string; total: unknown }) => ({ category: c.category, total: num(c.total) }))).toEqual(ts.byCategory);
    expect(sql.topMerchants.map((m: { merchant: string; total: unknown; count: unknown }) => ({ merchant: m.merchant, total: num(m.total), count: num(m.count) }))).toEqual(ts.topMerchants);
    expect(sql.trend.map((t: { month: string; total: unknown; count: unknown }) => ({ month: t.month, total: num(t.total), count: num(t.count) }))).toEqual(ts.trend);
    expect(num(sql.discretionaryTotal)).toBe(ts.discretionaryTotal);
    expect(num(sql.lateNightDiscretionary)).toBe(ts.lateNightDiscretionary);
    expect(ts.lateNightDiscretionary).toBeGreaterThan(0);
  });

  it("category_averages == calculateCategoryAverages", async () => {
    const sql = (await rowsOf(USER_A, `select category, avg from category_averages($1::date, 3)`, [`${month}-01`])).map((x) => ({ category: x.category, avg: num(x.avg) }));
    const ts = calculateCategoryAverages(await like(), month);
    expect(sql).toHaveLength(ts.length);
    sql.forEach((row, i) => {
      expect(row.category).toBe(ts[i]!.category);
      expect(row.avg).toBeCloseTo(ts[i]!.avg, 2);
    });
  });

  it("null merchants (nullable in the canonical schema) are ignored, and an empty user gets zeros, not nulls", async () => {
    await asUser(db, USER_A, () => db.query(`insert into expenses (user_id, amount, category, merchant, spent_on) values ($1, 5, 'Other', null, current_date)`, [USER_A]));
    const a = (await rowsOf(USER_A, `select spend_aggregates($1::date, $2::text[]) r`, [`${month}-01`, [...DISCRETIONARY_CATEGORIES]]))[0]!.r;
    expect(a.topMerchants.every((m: { merchant: string }) => m.merchant !== null && m.merchant !== "")).toBe(true);
    await asUser(db, USER_B, () => db.query(`insert into profiles (id, name) values ($1, 'B')`, [USER_B]));
    const empty = (await rowsOf(USER_B, `select spend_aggregates($1::date, $2::text[]) r`, [`${month}-01`, [...DISCRETIONARY_CATEGORIES]]))[0]!.r;
    expect(empty).toMatchObject({ total: 0, count: 0, byCategory: [], topMerchants: [] });
    expect(empty.trend).toHaveLength(6);
  });
});

describe("atomic helpers", () => {
  it("contribute_to_goal increments atomically and returns the row", async () => {
    const out = await asUser(db, USER_A, async () => {
      const goal = (await db.query<{ id: string; saved_amount: string }>(`select id, saved_amount from goals order by created_at limit 1`)).rows[0]!;
      const results = await Promise.all([1, 2, 3].map(() => db.query(`select * from contribute_to_goal($1, 100)`, [goal.id])));
      const final = (await db.query<{ saved_amount: string }>(`select saved_amount from goals where id = $1`, [goal.id])).rows[0]!;
      return { before: num(goal.saved_amount), final: num(final.saved_amount), returned: results.map((r) => r.rows.length) };
    });
    expect(out.final).toBe(out.before + 300);
    expect(out.returned).toEqual([1, 1, 1]);
  });

  it("contribute_to_goal ignores non-positive amounts", async () => {
    const r = await asUser(db, USER_A, async () => {
      const id = (await db.query<{ id: string }>(`select id from goals limit 1`)).rows[0]!.id;
      return db.query(`select * from contribute_to_goal($1, -50)`, [id]);
    });
    expect(r.rows).toHaveLength(0);
  });

  it("replace_budgets upserts on the canonical unique key, removes unlisted categories, touches only that month/user", async () => {
    const before = (await rowsOf(USER_A, `select count(*) n from budgets where month = $1`, [`${month}-01`]))[0]!.n;
    await asUser(db, USER_A, async () => {
      await db.query(`select * from replace_budgets('2030-01-01', $1::jsonb)`, [JSON.stringify([{ category: "Groceries", limit: 100, reason: "a" }, { category: "Transport", limit: 50 }])]);
      const r = await db.query<{ category: string; limit_amount: string }>(`select * from replace_budgets('2030-01-01', $1::jsonb)`, [JSON.stringify([{ category: "Groceries", limit: 999 }])]);
      expect(r.rows.map((x) => [x.category, num(x.limit_amount)])).toEqual([["Groceries", 999]]);
      expect(num((await db.query<{ n: string }>(`select count(*) n from budgets where month = '2030-01-01'`)).rows[0]!.n)).toBe(1);
    });
    expect(num((await rowsOf(USER_A, `select count(*) n from budgets where month = $1`, [`${month}-01`]))[0]!.n)).toBe(num(before));
    expect(await rowsOf(USER_B, `select 1 from budgets where month = '2030-01-01'`)).toHaveLength(0);
  });

  it("replace_budgets rejects non-first-of-month dates and unknown categories via canonical constraints", async () => {
    await expect(asUser(db, USER_A, () => db.query(`select * from replace_budgets('2030-01-15', '[{"category":"Other","limit":1}]'::jsonb)`))).rejects.toThrow();
    await expect(asUser(db, USER_A, () => db.query(`select * from replace_budgets('2030-01-01', '[{"category":"Crypto","limit":1}]'::jsonb)`))).rejects.toThrow();
  });
});
