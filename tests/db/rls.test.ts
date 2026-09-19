import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CATEGORIES } from "@/lib/finance/categories";
import { USER_A, USER_B, asUser, createDb, loadMigrations } from "./pg";

/** Runs against the CANONICAL schema/RLS from feature/db (+ the backend function migration). */
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
    await db.query(`insert into budgets (user_id, month, category, limit_amount) values ($1, '2026-09-01', 'Groceries', 5000)`, [USER_A]);
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

describe("migrations", () => {
  it("canonical migrations 1-4 plus the backend function migration all apply, in order", () => {
    const names = loadMigrations().map((m) => m.name);
    expect(names.slice(0, 4).map((n) => n.slice(0, 14))).toEqual([
      "20260919000001", "20260919000002", "20260919000003", "20260919000004",
    ]);
    expect(names.at(-1)).toBe("20260919000005_backend_functions.sql");
  });

  it("the backend migration defines no tables, indexes, policies or constraints (schema is owned by feature/db)", () => {
    const backend = loadMigrations().find((m) => m.name.startsWith("20260919000005"))!.sql.replace(/--.*$/gm, "");
    expect(backend).not.toMatch(/create\s+(table|index|domain|policy|extension)/i);
    expect(backend).not.toMatch(/alter\s+table/i);
    expect(backend).not.toMatch(/enable row level security/i);
  });

  it("every backend function is SECURITY INVOKER (RLS applies)", () => {
    const backend = loadMigrations().find((m) => m.name.startsWith("20260919000005"))!.sql.replace(/--.*$/gm, "");
    const fns = backend.match(/create or replace function/gi)!.length;
    expect(backend.match(/security invoker/gi)).toHaveLength(fns);
    expect(backend).not.toMatch(/security definer/i);
  });

  it("the TypeScript category list equals the canonical expense_category domain", () => {
    const schema = loadMigrations().find((m) => m.name.includes("initial_schema"))!.sql;
    const block = /create domain public\.expense_category as text\s+check \(([\s\S]*?)\n\s*\);/.exec(schema)![1]!;
    expect([...block.matchAll(/'([^']+)'/g)].map((m) => m[1])).toEqual([...CATEGORIES]);
  });
});

describe("RLS isolation (canonical policies)", () => {
  it.each(["profiles", "expenses", "budgets", "goals", "insights", "chat_messages"])("user B cannot read user A's %s", async (table) => {
    expect(await asUser(db, USER_B, () => count(table))).toBe(0);
    expect(await asUser(db, USER_A, () => count(table))).toBe(1);
  });

  it("anonymous role sees nothing and cannot write", async () => {
    for (const t of ["profiles", "expenses", "budgets", "goals", "insights", "chat_messages"]) {
      expect(await asUser(db, null, () => count(t))).toBe(0);
    }
    await asUser(db, null, async () => {
      await expect(db.query(`insert into expenses (user_id, amount, category, spent_on) values ($1, 5, 'Other', '2026-09-01')`, [USER_A])).rejects.toThrow();
    });
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

  it("user B cannot insert rows owned by A, or take over a row (WITH CHECK)", async () => {
    await asUser(db, USER_B, async () => {
      await expect(db.query(`insert into expenses (user_id, amount, category, spent_on) values ($1, 5, 'Other', '2026-09-01')`, [USER_A])).rejects.toThrow(/row-level security/);
      await expect(db.query(`insert into chat_messages (user_id, role, content) values ($1, 'user', 'x')`, [USER_A])).rejects.toThrow(/row-level security/);
      await expect(db.query(`insert into profiles (id, name) values ($1, 'x')`, [USER_A])).rejects.toThrow(/row-level security/);
      await db.query(`insert into expenses (user_id, amount, category, spent_on) values ($1, 5, 'Other', '2026-09-01')`, [USER_B]);
      await expect(db.query(`update expenses set user_id = $1 where user_id = $2`, [USER_A, USER_B])).rejects.toThrow(/row-level security/);
    });
  });

  it("insights and chat history are append-only for the owner (canonical: no update/delete policy)", async () => {
    await asUser(db, USER_A, async () => {
      expect((await db.query(`update chat_messages set content = 'edited'`)).affectedRows).toBe(0);
      expect((await db.query(`delete from insights`)).affectedRows).toBe(0);
    });
  });

  it("SECURITY INVOKER backend functions respect RLS", async () => {
    await asUser(db, USER_B, async () => {
      expect((await db.query(`select * from contribute_to_goal($1, 100)`, [aGoalId])).rows).toHaveLength(0);
    });
    expect((await asUser(db, USER_A, () => db.query(`select * from contribute_to_goal($1, 100)`, [aGoalId]))).rows).toHaveLength(1);
    const agg = await asUser(db, USER_B, () => db.query<{ r: { total: number } }>(`select spend_aggregates('2026-09-01', array['Shopping']) r`));
    expect(Number(agg.rows[0]!.r.total)).toBe(5); // only B's own 5
  });

  it("enforces the canonical unique(user_id, month, category) budget constraint", async () => {
    await asUser(db, USER_A, async () => {
      await expect(db.query(`insert into budgets (user_id, month, category, limit_amount) values ($1, '2026-09-01', 'Groceries', 1)`, [USER_A])).rejects.toThrow(/unique/i);
    });
  });
});

describe("canonical constraints the backend relies on", () => {
  it("rejects invalid values at the database level", async () => {
    await asUser(db, USER_A, async () => {
      const bad = (sql: string, params: unknown[] = []) => expect(db.query(sql, params)).rejects.toThrow();
      await bad(`insert into expenses (user_id, amount, category, spent_on) values ($1, 0, 'Other', '2026-09-01')`, [USER_A]);
      await bad(`insert into expenses (user_id, amount, category, spent_on) values ($1, 5, 'Nonsense', '2026-09-01')`, [USER_A]);
      await bad(`insert into expenses (user_id, amount, category, spent_on, source) values ($1, 5, 'Other', '2026-09-01', 'bad')`, [USER_A]);
      await bad(`update profiles set persona = 'evil' where id = $1`, [USER_A]);
      await bad(`insert into chat_messages (user_id, role, content) values ($1, 'system', 'x')`, [USER_A]);
      await bad(`insert into budgets (user_id, month, category, limit_amount) values ($1, '2026-10-01', 'Other', -1)`, [USER_A]);
      await bad(`insert into budgets (user_id, month, category, limit_amount) values ($1, '2026-10-15', 'Other', 1)`, [USER_A]);
    });
  });

  it("profiles.name is NOT NULL and merchant is nullable (the backend store handles both)", async () => {
    await asUser(db, USER_B, async () => {
      await expect(db.query(`insert into profiles (id) values ($1)`, [USER_B])).rejects.toThrow(/null value/);
      await db.query(`insert into profiles (id, name) values ($1, '')`, [USER_B]);
      const r = await db.query(`insert into expenses (user_id, amount, category, merchant, spent_on) values ($1, 7, 'Other', null, '2026-09-02') returning merchant`, [USER_B]);
      expect(r.rows[0]).toEqual({ merchant: null });
    });
  });
});
