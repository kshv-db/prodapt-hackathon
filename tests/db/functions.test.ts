import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { aggregateSpend, calculateCategoryAverages, type ExpenseLike } from "@/lib/finance/aggregate";
import { DISCRETIONARY_CATEGORIES, LATE_NIGHT_FROM, LATE_NIGHT_UNTIL } from "@/lib/finance/categories";
import { monthOf } from "@/lib/finance/dates";
import { buildSeedPayload } from "@/lib/server/seed-data";
import { USER_A, USER_B, asUser, createDb } from "./pg";

let db: PGlite;
const today = "2026-09-19";
const month = monthOf(today);
const payload = buildSeedPayload(today);

const seed = (uid: string) =>
  asUser(db, uid, async () =>
    (
      await db.query<{ seed_demo: boolean }>(`select seed_demo($1::jsonb, $2::jsonb, $3::date, $4::jsonb, $5::jsonb)`, [
        JSON.stringify(payload.profile),
        JSON.stringify(payload.expenses),
        payload.budgetMonth,
        JSON.stringify(payload.budgets),
        JSON.stringify(payload.goals),
      ])
    ).rows[0]!.seed_demo,
  );

beforeAll(async () => {
  db = await createDb();
});
afterAll(async () => db.close());

const num = (v: unknown) => Number(v);

describe("seed_demo (idempotent, atomic, user-scoped)", () => {
  it("seeds once; the second call inserts nothing", async () => {
    expect(await seed(USER_A)).toBe(true);
    const count = async (t: string) => num((await asUser(db, USER_A, () => db.query<{ n: string }>(`select count(*) n from ${t}`))).rows[0]!.n);
    const first = { e: await count("expenses"), b: await count("budgets"), g: await count("goals") };
    expect(first.e).toBe(payload.expenses.length);
    expect(first.g).toBe(2);
    expect(await seed(USER_A)).toBe(false);
    expect({ e: await count("expenses"), b: await count("budgets"), g: await count("goals") }).toEqual(first);
  });

  it("creates the profile with demo income and marks every expense as seed", async () => {
    const p = await asUser(db, USER_A, () => db.query<{ monthly_income: string; persona: string }>(`select monthly_income, persona from profiles`));
    expect(num(p.rows[0]!.monthly_income)).toBe(45_000);
    const s = await asUser(db, USER_A, () => db.query<{ source: string }>(`select distinct source from expenses`));
    expect(s.rows.map((r) => r.source)).toEqual(["seed"]);
  });

  it("does not touch another user's data", async () => {
    const n = await asUser(db, USER_B, () => db.query<{ n: string }>(`select count(*) n from expenses`));
    expect(num(n.rows[0]!.n)).toBe(0);
    expect(await seed(USER_B)).toBe(true); // independent seed for B
  });

  it("refuses unauthenticated callers", async () => {
    await expect(
      asUser(db, null, () => db.query(`select seed_demo('{}'::jsonb, '[]'::jsonb, '2026-09-01', '[]'::jsonb, '[]'::jsonb)`)),
    ).rejects.toThrow();
  });

  it("a double click (concurrent calls) still seeds exactly once", async () => {
    const uid = "33333333-3333-3333-3333-333333333333";
    await db.exec(`insert into auth.users (id) values ('${uid}')`);
    const results = await Promise.all([seed(uid), seed(uid)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const n = await asUser(db, uid, () => db.query<{ n: string }>(`select count(*) n from expenses`));
    expect(num(n.rows[0]!.n)).toBe(payload.expenses.length);
  });
});

describe("SQL aggregates match the TypeScript reference implementation", () => {
  const like: ExpenseLike[] = payload.expenses.map((e) => ({ amount: e.amount, category: e.category, merchant: e.merchant, spent_on: e.spent_on, spent_at: e.spent_at ?? null }));

  it("spend_aggregates == aggregateSpend (total, categories, merchants, 6-month trend, late-night)", async () => {
    const r = await asUser(db, USER_A, () =>
      db.query<{ r: Record<string, any> }>(`select spend_aggregates($1::date, $2::text[], $3::time, $4::time) r`, [ // eslint-disable-line @typescript-eslint/no-explicit-any
        `${month}-01`,
        [...DISCRETIONARY_CATEGORIES],
        LATE_NIGHT_FROM,
        LATE_NIGHT_UNTIL,
      ]),
    );
    const sql = r.rows[0]!.r;
    const ts = aggregateSpend(like, month);
    expect(num(sql.total)).toBe(ts.total);
    expect(num(sql.count)).toBe(ts.count);
    expect(sql.byCategory.map((c: { category: string; total: unknown }) => ({ category: c.category, total: num(c.total) }))).toEqual(ts.byCategory);
    expect(sql.topMerchants.map((m: { merchant: string; total: unknown; count: unknown }) => ({ merchant: m.merchant, total: num(m.total), count: num(m.count) }))).toEqual(ts.topMerchants);
    expect(sql.trend.map((t: { month: string; total: unknown; count: unknown }) => ({ month: t.month, total: num(t.total), count: num(t.count) }))).toEqual(ts.trend);
    expect(num(sql.discretionaryTotal)).toBe(ts.discretionaryTotal);
    expect(num(sql.lateNightDiscretionary)).toBe(ts.lateNightDiscretionary);
    expect(ts.lateNightDiscretionary).toBeGreaterThan(0); // the seeded late-night food pattern is really there
  });

  it("category_averages == calculateCategoryAverages", async () => {
    const r = await asUser(db, USER_A, () => db.query<{ category: string; avg: string }>(`select * from category_averages($1::date, 3)`, [`${month}-01`]));
    const sql = r.rows.map((x) => ({ category: x.category, avg: num(x.avg) }));
    const ts = calculateCategoryAverages(like, month);
    expect(sql).toHaveLength(ts.length);
    sql.forEach((row, i) => {
      expect(row.category).toBe(ts[i]!.category);
      expect(row.avg).toBeCloseTo(ts[i]!.avg, 2);
    });
  });

  it("an empty user gets zeros and a zero-filled trend, not nulls", async () => {
    const uid = "44444444-4444-4444-4444-444444444444";
    await db.exec(`insert into auth.users (id) values ('${uid}')`);
    const r = await asUser(db, uid, () =>
      db.query<{ r: Record<string, any> }>(`select spend_aggregates($1::date, $2::text[]) r`, [`${month}-01`, [...DISCRETIONARY_CATEGORIES]]), // eslint-disable-line @typescript-eslint/no-explicit-any
    );
    expect(r.rows[0]!.r).toMatchObject({ total: 0, count: 0, byCategory: [], topMerchants: [] });
    expect(r.rows[0]!.r.trend).toHaveLength(6);
  });
});

describe("atomic helpers", () => {
  it("contribute_to_goal increments atomically and returns the row", async () => {
    const g = await asUser(db, USER_A, async () => {
      const goal = (await db.query<{ id: string; saved_amount: string }>(`select id, saved_amount from goals order by created_at limit 1`)).rows[0]!;
      const results = await Promise.all([1, 2, 3].map(() => db.query<{ saved_amount: string }>(`select * from contribute_to_goal($1, 100)`, [goal.id])));
      const final = (await db.query<{ saved_amount: string }>(`select saved_amount from goals where id = $1`, [goal.id])).rows[0]!;
      return { before: num(goal.saved_amount), final: num(final.saved_amount), returned: results.map((r) => r.rows.length) };
    });
    expect(g.final).toBe(g.before + 300);
    expect(g.returned).toEqual([1, 1, 1]);
  });

  it("contribute_to_goal ignores non-positive amounts", async () => {
    const r = await asUser(db, USER_A, async () => {
      const id = (await db.query<{ id: string }>(`select id from goals limit 1`)).rows[0]!.id;
      return db.query(`select * from contribute_to_goal($1, -50)`, [id]);
    });
    expect(r.rows).toHaveLength(0);
  });

  it("replace_budgets upserts listed categories and removes the rest, only for the caller and month", async () => {
    await asUser(db, USER_A, async () => {
      await db.query(`select * from replace_budgets('2026-10-01', $1::jsonb)`, [JSON.stringify([{ category: "Groceries", limit: 100, reason: "a" }, { category: "Transport", limit: 50 }])]);
      const r = await db.query<{ category: string; limit_amount: string }>(`select * from replace_budgets('2026-10-01', $1::jsonb)`, [JSON.stringify([{ category: "Groceries", limit: 999 }])]);
      expect(r.rows.map((x) => [x.category, num(x.limit_amount)])).toEqual([["Groceries", 999]]);
      const oct = await db.query<{ n: string }>(`select count(*) n from budgets where month = '2026-10-01'`);
      expect(num(oct.rows[0]!.n)).toBe(1);
      const sep = await db.query<{ n: string }>(`select count(*) n from budgets where month = '${month}-01'`);
      expect(num(sep.rows[0]!.n)).toBeGreaterThan(0); // other months untouched
    });
    const b = await asUser(db, USER_B, () => db.query<{ n: string }>(`select count(*) n from budgets where month = '2026-10-01'`));
    expect(num(b.rows[0]!.n)).toBe(0);
  });

  it("budget months must be first-of-month dates", async () => {
    await expect(asUser(db, USER_A, () => db.query(`select * from replace_budgets('2026-10-15', '[{"category":"Other","limit":1}]'::jsonb)`))).rejects.toThrow();
  });
});
