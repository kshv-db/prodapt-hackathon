import { readFileSync } from "node:fs";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CATEGORIES } from "@/lib/finance/categories";
import { USER_A, USER_B, asUser, createDb } from "./pg";

let db: PGlite;
let aExpenseId: string;
let aGoalId: string;

beforeAll(async () => {
  db = await createDb();
  await asUser(db, USER_A, async () => {
    await db.query(`insert into profiles (id, name, monthly_income) values ($1, 'A', 50000)`, [USER_A]);
    const e = await db.query<{ id: string }>(
      `insert into expenses (user_id, amount, category, merchant, spent_on) values ($1, 100, 'Groceries', 'BigBasket', '2026-09-01') returning id`,
      [USER_A],
    );
    aExpenseId = e.rows[0]!.id;
    await db.query(
      `insert into budgets (user_id, month, category, limit_amount) values ($1, '2026-09-01', 'Groceries', 5000)`,
      [USER_A],
    );
    const g = await db.query<{ id: string }>(
      `insert into goals (user_id, title, target_amount, deadline) values ($1, 'Laptop', 60000, '2027-01-01') returning id`,
      [USER_A],
    );
    aGoalId = g.rows[0]!.id;
    await db.query(`insert into insights (user_id, kind, body) values ($1, 'dashboard', 'hello')`, [USER_A]);
    await db.query(`insert into chat_messages (user_id, role, content) values ($1, 'user', 'hi')`, [USER_A]);
  });
});
afterAll(async () => db.close());

const count = async (table: string) => Number((await db.query<{ n: string }>(`select count(*) n from ${table}`)).rows[0]!.n);

describe("RLS isolation", () => {
  it.each(["profiles", "expenses", "budgets", "goals", "insights", "chat_messages"])(
    "user B cannot read user A's %s",
    async (table) => {
      expect(await asUser(db, USER_B, () => count(table))).toBe(0);
      expect(await asUser(db, USER_A, () => count(table))).toBe(1);
    },
  );

  it("anonymous role sees nothing and cannot insert", async () => {
    await expect(asUser(db, null, () => count("expenses"))).rejects.toThrow();
  });

  it("user B cannot update or delete A's expense", async () => {
    await asUser(db, USER_B, async () => {
      expect((await db.query(`update expenses set amount = 1 where id = $1`, [aExpenseId])).affectedRows).toBe(0);
      expect((await db.query(`delete from expenses where id = $1`, [aExpenseId])).affectedRows).toBe(0);
    });
    expect(await count("expenses")).toBe(1);
  });

  it("user B cannot modify A's budgets, goals or profile", async () => {
    await asUser(db, USER_B, async () => {
      expect((await db.query(`update budgets set limit_amount = 1`)).affectedRows).toBe(0);
      expect((await db.query(`delete from budgets`)).affectedRows).toBe(0);
      expect((await db.query(`update goals set saved_amount = 999 where id = $1`, [aGoalId])).affectedRows).toBe(0);
      expect((await db.query(`delete from goals`)).affectedRows).toBe(0);
      expect((await db.query(`update profiles set monthly_income = 1`)).affectedRows).toBe(0);
    });
  });

  it("user B cannot insert rows owned by A (WITH CHECK)", async () => {
    await asUser(db, USER_B, async () => {
      await expect(
        db.query(`insert into expenses (user_id, amount, category, spent_on) values ($1, 5, 'Other', '2026-09-01')`, [USER_A]),
      ).rejects.toThrow(/row-level security/);
      await expect(
        db.query(`insert into chat_messages (user_id, role, content) values ($1, 'user', 'x')`, [USER_A]),
      ).rejects.toThrow(/row-level security/);
      await expect(db.query(`insert into profiles (id) values ($1)`, [USER_A])).rejects.toThrow(/row-level security/);
    });
  });

  it("user B cannot move a row to another owner via update", async () => {
    await asUser(db, USER_B, async () => {
      await db.query(
        `insert into expenses (user_id, amount, category, spent_on) values ($1, 5, 'Other', '2026-09-01')`,
        [USER_B],
      );
      await expect(db.query(`update expenses set user_id = $1 where user_id = $2`, [USER_A, USER_B])).rejects.toThrow(
        /row-level security/,
      );
    });
  });

  it("user_id defaults to auth.uid() so it cannot be forged by omission", async () => {
    await asUser(db, USER_B, async () => {
      const r = await db.query<{ user_id: string }>(
        `insert into insights (kind, body) values ('x', 'y') returning user_id`,
      );
      expect(r.rows[0]!.user_id).toBe(USER_B);
    });
  });

  it("SECURITY INVOKER functions respect RLS", async () => {
    await asUser(db, USER_B, async () => {
      const g = await db.query(`select * from contribute_to_goal($1, 100)`, [aGoalId]);
      expect(g.rows).toHaveLength(0);
    });
    const a = await asUser(db, USER_A, () => db.query(`select * from contribute_to_goal($1, 100)`, [aGoalId]));
    expect(a.rows).toHaveLength(1);
    const agg = await asUser(db, USER_B, () =>
      db.query<{ r: { total: number } }>(`select spend_aggregates('2026-09-01', array['Shopping']) r`),
    );
    expect(Number(agg.rows[0]!.r.total)).toBe(5); // only B's own 5
  });

  it("enforces the unique(user_id, month, category) budget constraint", async () => {
    await asUser(db, USER_A, async () => {
      await expect(
        db.query(`insert into budgets (user_id, month, category, limit_amount) values ($1, '2026-09-01', 'Groceries', 1)`, [USER_A]),
      ).rejects.toThrow(/unique/i);
    });
  });
});

describe("schema constraints", () => {
  it("rejects invalid values at the database level", async () => {
    await asUser(db, USER_A, async () => {
      await expect(db.query(`insert into expenses (user_id, amount, category, spent_on) values ($1, 0, 'Other', '2026-09-01')`, [USER_A])).rejects.toThrow();
      await expect(db.query(`insert into expenses (user_id, amount, category, spent_on) values ($1, 5, 'Nonsense', '2026-09-01')`, [USER_A])).rejects.toThrow();
      await expect(db.query(`insert into expenses (user_id, amount, category, spent_on, source) values ($1, 5, 'Other', '2026-09-01', 'bad')`, [USER_A])).rejects.toThrow();
      await expect(db.query(`update profiles set persona = 'evil' where id = $1`, [USER_A])).rejects.toThrow();
      await expect(db.query(`insert into chat_messages (user_id, role, content) values ($1, 'system', 'x')`, [USER_A])).rejects.toThrow();
      await expect(db.query(`insert into budgets (user_id, month, category, limit_amount) values ($1, '2026-10-01', 'Other', -1)`, [USER_A])).rejects.toThrow();
    });
  });

  it("SQL category list matches the shared TypeScript constant", () => {
    const sql = readFileSync(path.resolve(__dirname, "../../supabase/migrations/20260919000000_init.sql"), "utf8");
    const block = /category\s+text not null check \(category in \(([\s\S]*?)\)\)/.exec(sql)![1]!;
    const fromSql = [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(fromSql).toEqual([...CATEGORIES]);
  });
});
