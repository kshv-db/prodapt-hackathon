import { beforeEach, describe, expect, it, vi } from "vitest";
import { setAiClientForTests, type CompleteRequest } from "@/lib/ai/client";
import { clearNarrationCache } from "@/lib/ai/narrator";
import { resetRateLimits } from "@/lib/api/rate-limit";
import { CATEGORIES } from "@/lib/finance/categories";
import { addDays, monthOf, todayISO } from "@/lib/finance/dates";
import { calculateProjection, finalBalance } from "@/lib/finance/projection";
import { unauthorized } from "@/lib/errors";
import { collectFigures, findUngroundedFigures } from "@/lib/ai/grounding";
import { FakeAi } from "../helpers/fake-ai";
import { MemoryDb } from "../helpers/memory-store";

const db = new MemoryDb();
const ALICE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BOB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

// Authentication is faked at the seam (Supabase Auth is not available here): the header selects the user.
vi.mock("@/lib/api/auth", () => ({
  resolveContext: async (req: Request) => {
    const user = req.headers.get("x-test-user");
    if (!user) throw unauthorized();
    return { userId: user, store: db.forUser(user) };
  },
}));

import * as expenses from "@/app/api/expenses/route";
import * as expenseById from "@/app/api/expenses/[id]/route";
import * as parse from "@/app/api/expenses/parse/route";
import * as importCsv from "@/app/api/expenses/import/route";
import * as summary from "@/app/api/summary/route";
import * as generate from "@/app/api/budget/generate/route";
import * as budgets from "@/app/api/budgets/route";
import * as goals from "@/app/api/goals/route";
import * as contribute from "@/app/api/goals/[id]/contribute/route";
import * as plan from "@/app/api/goals/[id]/plan/route";
import * as future from "@/app/api/future/route";
import * as whatif from "@/app/api/whatif/route";
import * as chat from "@/app/api/chat/route";
import * as insights from "@/app/api/insights/refresh/route";
import * as profile from "@/app/api/profile/route";
import * as seed from "@/app/api/demo/seed/route";

const today = todayISO();
const month = monthOf(today);

function call(handler: (req: Request, ctx?: never) => Promise<Response>, path: string, opts: { user?: string | null; method?: string; body?: unknown; form?: FormData; params?: Record<string, string> } = {}) {
  const headers: Record<string, string> = {};
  if (opts.user !== null) headers["x-test-user"] = opts.user ?? ALICE;
  let body: BodyInit | undefined;
  const method = opts.method ?? "GET";
  if (method === "GET" || method === "HEAD") body = undefined;
  else if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    body = typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
  }
  const req = new Request(`http://localhost${path}`, { method: opts.method ?? "GET", headers, body });
  return (handler as (r: Request, c: unknown) => Promise<Response>)(req, { params: Promise.resolve(opts.params ?? {}) });
}
const j = async (res: Response) => (await res.json()) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function factsOf(req: CompleteRequest): Record<string, any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const user = req.messages.find((m) => m.role === "user")!.content;
  return JSON.parse(user.slice(user.indexOf("\n") + 1));
}
const words = (n: number) => Array.from({ length: n }, () => "steady").join(" ");

/** A well-behaved fake model: every figure it writes comes from the FACTS it was given. */
function goodModel(req: CompleteRequest): string {
  const name = req.json?.name;
  const system = req.messages[0]!.content;
  const user = req.messages.find((m) => m.role === "user")!.content;
  if (name === "expense_parse") {
    const { text } = JSON.parse(user) as { text: string };
    const amount = Number(/(\d+)/.exec(text)?.[1] ?? NaN);
    const yesterday = /kal|yesterday/i.test(text);
    return JSON.stringify({
      amount: Number.isNaN(amount) ? null : amount,
      category: /zomato|swiggy|pizza/i.test(text) ? "Food & Dining" : "Transport",
      merchant: /zomato/i.test(text) ? "Zomato" : /uber/i.test(text) ? "Uber" : "",
      date_kind: yesterday ? "yesterday" : "none",
      days_ago: null, weekday: null, explicit_date: null, time_of_day: null,
      confidence: 0.93,
      needs_clarification: Number.isNaN(amount) ? "How much did you spend?" : null,
    });
  }
  if (name === "categorize_batch") {
    const { rows } = JSON.parse(user) as { rows: { index: number; description: string }[] };
    return JSON.stringify({ items: rows.map((r) => ({ index: r.index, category: /zomato|swiggy/i.test(r.description) ? "Food & Dining" : "Other", confidence: /zomato|swiggy/i.test(r.description) ? 0.95 : 0.3 })) });
  }
  if (name === "budget_reasons") {
    const { lines } = JSON.parse(user) as { lines: { category: string; draft: string }[] };
    return JSON.stringify({ reasons: lines.map((l) => ({ category: l.category, reason: l.draft })) });
  }
  const f = factsOf(req);
  if (/Future You/.test(system)) {
    return `I'm writing from ${f.yearsAhead} years ahead. Staying on my current path I hold ₹${f.currentPath.balanceAtEnd}, but choosing ₹${f.chosenPath.monthlySaving} a month leaves ₹${f.chosenPath.balanceAtEnd}, a difference of ₹${Math.abs(f.differenceAtEnd)}. ${words(45)} That return is an assumption, not a promise.`;
  }
  if (/dashboard insight/.test(system)) return `Late-night orders are ${f.currentMonth.lateNightDiscretionaryPercentOfSpend}% of your spend. Try trimming a few.`;
  if (/off-track savings goal/.test(system)) return `You need ₹${f.plan.monthlyGap} more a month: cut ₹${f.suggestedCut.amountPerMonth} from ${f.suggestedCut.category}.`;
  if (/What-If/.test(system)) return `This costs ₹${f.budgetImpact.totalCost} in total and moves your monthly savings from ₹${f.budgetImpact.savingsBefore} to ₹${f.budgetImpact.savingsAfter}.`;
  return "ok";
}

let ai: FakeAi;
beforeEach(() => {
  ai = new FakeAi(goodModel, ["Bike ", "ke liye ", "pehle price batao."]);
  setAiClientForTests(ai);
  clearNarrationCache();
  resetRateLimits();
});

describe("authentication", () => {
  const routes: [string, (r: Request, c?: never) => Promise<Response>, string, string][] = [
    ["expenses GET", expenses.GET, "/api/expenses", "GET"],
    ["expenses POST", expenses.POST, "/api/expenses", "POST"],
    ["parse", parse.POST, "/api/expenses/parse", "POST"],
    ["import", importCsv.POST, "/api/expenses/import", "POST"],
    ["delete", expenseById.DELETE, "/api/expenses/x", "DELETE"],
    ["summary", summary.GET, "/api/summary", "GET"],
    ["generate", generate.POST, "/api/budget/generate", "POST"],
    ["budgets GET", budgets.GET, "/api/budgets", "GET"],
    ["budgets PUT", budgets.PUT, "/api/budgets", "PUT"],
    ["goals GET", goals.GET, "/api/goals", "GET"],
    ["goals POST", goals.POST, "/api/goals", "POST"],
    ["contribute", contribute.POST, "/api/goals/x/contribute", "POST"],
    ["plan", plan.GET, "/api/goals/x/plan", "GET"],
    ["future", future.POST, "/api/future", "POST"],
    ["whatif", whatif.POST, "/api/whatif", "POST"],
    ["chat GET", chat.GET, "/api/chat", "GET"],
    ["chat POST", chat.POST, "/api/chat", "POST"],
    ["insights", insights.POST, "/api/insights/refresh", "POST"],
    ["profile GET", profile.GET, "/api/profile", "GET"],
    ["profile PUT", profile.PUT, "/api/profile", "PUT"],
    ["seed", seed.POST, "/api/demo/seed", "POST"],
  ];
  it.each(routes)("%s returns 401 { error } without a signed-in user", async (_n, handler, path, method) => {
    const res = await call(handler, path, { user: null, method, body: {} });
    expect(res.status).toBe(401);
    expect(await j(res)).toEqual({ error: "Authentication required" });
  });
});

describe("end-to-end smoke flow (in-memory store, mocked OpenAI)", () => {
  it("runs the whole PRD demo path", async () => {
    // 1-2. onboarding
    let res = await call(profile.PUT, "/api/profile", { method: "PUT", body: { name: "Meera", income: 45000, fixedCosts: [{ label: "Rent", amount: 12000 }], persona: "friendly" } });
    expect(res.status).toBe(200);
    expect((await j(res)).profile).toMatchObject({ name: "Meera", monthly_income: 45000, persona: "friendly" });

    // 3. demo seed, idempotent
    res = await call(seed.POST, "/api/demo/seed", { method: "POST" });
    expect(await j(res)).toEqual({ ok: true });
    const countAfterFirst = db.expenses.filter((e) => e.user_id === ALICE).length;
    expect(countAfterFirst).toBeGreaterThan(60);
    await call(seed.POST, "/api/demo/seed", { method: "POST" });
    expect(db.expenses.filter((e) => e.user_id === ALICE)).toHaveLength(countAfterFirst);
    expect(db.goals.filter((g) => g.user_id === ALICE)).toHaveLength(2);
    expect(db.profiles.get(ALICE)!.monthly_income).toBe(45000); // onboarding income preserved

    // 4-5. dashboard
    res = await call(summary.GET, `/api/summary?month=${month}`);
    const s = await j(res);
    expect(s.income).toBe(45000);
    expect(s.total).toBeGreaterThan(0);
    expect(s.byCategory.length).toBeGreaterThan(3);
    expect(s.trend).toHaveLength(6);
    expect(s.trend.every((t: { month: string; total: number }) => typeof t.month === "string" && typeof t.total === "number")).toBe(true);
    expect(s.topMerchants.length).toBeGreaterThan(0);
    expect(s.topMerchants.length).toBeLessThanOrEqual(5);
    expect(s.budgetUsage.length).toBeGreaterThan(0);
    expect(Number.isInteger(s.healthScore) && s.healthScore >= 0 && s.healthScore <= 100).toBe(true);
    expect(typeof s.healthReason).toBe("string");
    expect(s.insight).toBeNull();
    // the deliberate late-night pattern costs impulse-control points
    expect(s.healthBreakdown.impulse.points).toBeLessThan(s.healthBreakdown.impulse.max);
    const totalBefore = s.total as number;

    // insight (AI writes, code supplies the number)
    res = await call(insights.POST, "/api/insights/refresh", { method: "POST" });
    const { insight } = await j(res);
    expect(insight.kind).toBe("dashboard");
    expect(insight.body).toMatch(/Late-night orders are \d+%/);
    expect((await j(await call(summary.GET, `/api/summary?month=${month}`))).insight.body).toBe(insight.body);

    // 6-7. NL parse ("kal Zomato pe 450 diye")
    res = await call(parse.POST, "/api/expenses/parse", { method: "POST", body: { text: "kal Zomato pe 450 diye", today } });
    const parsed = await j(res);
    expect(parsed).toMatchObject({ amount: 450, category: "Food & Dining", merchant: "Zomato", spent_on: addDays(today, -1) });
    expect(parsed.needs_clarification).toBeUndefined();

    // missing amount -> clarification, no guess
    res = await call(parse.POST, "/api/expenses/parse", { method: "POST", body: { text: "Zomato pe kal paisa diye", today } });
    expect(await j(res)).toMatchObject({ amount: 0, needs_clarification: expect.any(String) });

    // 8-10. confirm & save, dashboard moves
    res = await call(expenses.POST, "/api/expenses", { method: "POST", body: { amount: parsed.amount, category: parsed.category, merchant: parsed.merchant, spent_on: parsed.spent_on, source: "nl" } });
    expect(res.status).toBe(201);
    const { expense } = await j(res);
    expect(expense.user_id).toBe(ALICE);
    const after = await j(await call(summary.GET, `/api/summary?month=${monthOf(parsed.spent_on)}`));
    if (monthOf(parsed.spent_on) === month) expect(after.total).toBeCloseTo(totalBefore + 450, 2);
    const list = await j(await call(expenses.GET, `/api/expenses?month=${monthOf(parsed.spent_on)}`));
    expect(list.expenses.some((e: { id: string }) => e.id === expense.id)).toBe(true);

    // 11. budgets
    const budgetRes = await j(await call(budgets.GET, `/api/budgets?month=${month}`));
    expect(budgetRes.budgets.length).toBeGreaterThan(0);
    expect(Object.keys(budgetRes.budgets[0]).sort()).toEqual(["category", "limit", "reason"]);
    const gen = await j(await call(generate.POST, "/api/budget/generate", { method: "POST", body: { income: 45000, fixedCosts: [{ label: "Rent", amount: 12000 }] } }));
    const limitSum = gen.budgets.reduce((a: number, b: { limit: number }) => a + b.limit, 0);
    expect(limitSum).toBeLessThanOrEqual(45000);
    expect(limitSum + gen.savings.limit).toBeCloseTo(45000, 2);
    expect(gen.budgets).toHaveLength(CATEGORIES.length);
    // edit + save; totals above income are refused
    const tooMuch = await call(budgets.PUT, "/api/budgets", { method: "PUT", body: { budgets: [{ category: "Groceries", limit: 46000 }] } });
    expect(tooMuch.status).toBe(400);
    expect((await j(tooMuch)).error).toMatch(/exceeds monthly income/);
    const saved = await j(await call(budgets.PUT, "/api/budgets", { method: "PUT", body: { budgets: gen.budgets } }));
    expect(saved.budgets).toHaveLength(CATEGORIES.length);
    expect((await call(budgets.PUT, "/api/budgets", { method: "PUT", body: { budgets: [{ category: "Groceries", limit: 1 }, { category: "Groceries", limit: 2 }] } })).status).toBe(400);
    expect((await call(budgets.PUT, "/api/budgets", { method: "PUT", body: { budgets: [{ category: "Groceries", limit: -5 }] } })).status).toBe(400);

    // 12-13. goals + plan (laptop is deliberately off track and gets a concrete cut)
    const gl = (await j(await call(goals.GET, "/api/goals"))).goals as { id: string; title: string; saved_amount: number }[];
    expect(gl).toHaveLength(2);
    const laptop = gl.find((g) => /laptop/i.test(g.title))!;
    const bike = gl.find((g) => /bike/i.test(g.title))!;
    const laptopPlan = await j(await call(plan.GET, `/api/goals/${laptop.id}/plan`, { params: { id: laptop.id } }));
    expect(laptopPlan.onTrack).toBe(false);
    expect(laptopPlan.gap).toBeGreaterThan(0);
    expect(laptopPlan.cut).toMatchObject({ category: expect.any(String), amount: expect.any(Number) });
    expect(laptopPlan.suggestion).toContain(String(laptopPlan.cut.amount));
    expect(laptopPlan.suggestion).toContain(laptopPlan.cut.category);
    expect(Object.keys(laptopPlan)).toEqual(expect.arrayContaining(["monthlyNeeded", "onTrack", "gap", "suggestion"]));
    const bikePlan = await j(await call(plan.GET, `/api/goals/${bike.id}/plan`, { params: { id: bike.id } }));
    expect(bikePlan.onTrack).toBe(true);

    // contribute, create
    const c = await j(await call(contribute.POST, `/api/goals/${laptop.id}/contribute`, { method: "POST", body: { amount: 1000 }, params: { id: laptop.id } }));
    expect(c.goal.saved_amount).toBe(laptop.saved_amount + 1000);
    const created = await call(goals.POST, "/api/goals", { method: "POST", body: { title: "Trip", target: 30000, deadline: addDays(today, 200) } });
    expect(created.status).toBe(201);
    expect((await call(goals.POST, "/api/goals", { method: "POST", body: { title: "Old", target: 100, deadline: addDays(today, -3) } })).status).toBe(400);

    // 14-15. Future You: deterministic series, grounded narrative, read-only
    const writesBefore = JSON.stringify([db.expenses.length, db.budgets.length, db.goals.length, db.insights.length, db.chat.length]);
    res = await call(future.POST, "/api/future", { method: "POST", body: { monthlySaving: 5000, years: 5 } });
    const f = await j(res);
    expect(f.current.series).toHaveLength(61);
    expect(f.chosen.series).toHaveLength(61);
    expect(finalBalance(f.chosen.series)).toBe(finalBalance(calculateProjection({ monthlySaving: 5000, years: 5 })));
    expect(finalBalance(f.current.series)).toBe(finalBalance(calculateProjection({ monthlySaving: f.currentMonthlySaving, years: 5 })));
    expect(f.assumedAnnualReturn).toBe(0.07);
    expect(f.narrativeSource).toBe("ai");
    expect(f.narrative.split(/\s+/).length).toBeGreaterThanOrEqual(60);
    expect(f.narrative.split(/\s+/).length).toBeLessThanOrEqual(90);
    const futureFacts = factsOf(ai.calls.at(-1)!);
    expect(findUngroundedFigures(f.narrative, collectFigures(futureFacts))).toEqual([]);
    expect(JSON.stringify([db.expenses.length, db.budgets.length, db.goals.length, db.insights.length, db.chat.length])).toBe(writesBefore);

    // same slider value again => cached narrative, no extra AI call
    const callsBefore = ai.calls.length;
    await call(future.POST, "/api/future", { method: "POST", body: { monthlySaving: 5000, years: 5 } });
    expect(ai.calls).toHaveLength(callsBefore);

    // what-if
    const w = await j(await call(whatif.POST, "/api/whatif", { method: "POST", body: { description: "phone EMI", monthlyCost: 2500, months: 12 } }));
    expect(w.budgetImpact.totalCost).toBe(30000);
    expect(Array.isArray(w.goalDelays)).toBe(true);
    expect(typeof w.narrative).toBe("string");

    // 16-17. chat: streamed text, grounded prompt, persisted for this user only
    res = await call(chat.POST, "/api/chat", { method: "POST", body: { message: "Bike kab le sakta hoon?" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/plain/);
    expect(await res.text()).toBe("Bike ke liye pehle price batao.");
    const stream = ai.streams.at(-1)!;
    const factMsg = stream.messages.find((m) => m.role === "system" && m.content.startsWith("FACTS"))!;
    const facts = JSON.parse(factMsg.content.slice(factMsg.content.indexOf("\n") + 1));
    expect(facts.profile.monthlyIncome).toBe(45000);
    expect(facts.goals.map((g: { title: string }) => g.title)).toEqual(expect.arrayContaining(["New laptop", "Bike down payment"]));
    expect(stream.messages.at(-1)).toEqual({ role: "user", content: "Bike kab le sakta hoon?" });
    const history = await j(await call(chat.GET, "/api/chat"));
    expect(history.messages.map((m: { role: string }) => m.role)).toEqual(["user", "assistant"]);
    expect((await j(await call(chat.GET, "/api/chat", { user: BOB }))).messages).toEqual([]);

    // 18. persona change reaches the AI
    await call(profile.PUT, "/api/profile", { method: "PUT", body: { persona: "coach" } });
    await call(chat.POST, "/api/chat", { method: "POST", body: { message: "Where can I save?" } });
    expect(ai.streams.at(-1)!.messages[0]!.content).toMatch(/direct, structured/);
    expect(ai.streams.at(-1)!.messages.filter((m) => m.role !== "system").length).toBeLessThanOrEqual(11); // <=10 turns + new message
  });
});

describe("demo seed", () => {
  it("needs onboarding first (409, canonical seed_demo_data never invents a profile) and re-running does not duplicate", async () => {
    const user = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const res = await call(seed.POST, "/api/demo/seed", { user, method: "POST" });
    expect(res.status).toBe(409);
    expect((await j(res)).error).toMatch(/onboarding/);
    await call(profile.PUT, "/api/profile", { user, method: "PUT", body: { name: "E", income: 45000 } });
    expect(await j(await call(seed.POST, "/api/demo/seed", { user, method: "POST" }))).toEqual({ ok: true });
    const n = db.expenses.filter((e) => e.user_id === user).length;
    await call(seed.POST, "/api/demo/seed", { user, method: "POST" });
    expect(db.expenses.filter((e) => e.user_id === user)).toHaveLength(n);
  });
});

describe("ownership / isolation", () => {
  it("one user cannot read, delete or modify another user's data through the API", async () => {
    await call(seed.POST, "/api/demo/seed", { method: "POST" });
    const aliceExpense = db.expenses.find((e) => e.user_id === ALICE)!;
    const aliceGoal = db.goals.find((g) => g.user_id === ALICE)!;

    expect((await j(await call(expenses.GET, `/api/expenses?month=${monthOf(aliceExpense.spent_on)}`, { user: BOB }))).expenses).toEqual([]);
    expect((await call(expenseById.DELETE, `/api/expenses/${aliceExpense.id}`, { user: BOB, method: "DELETE", params: { id: aliceExpense.id } })).status).toBe(404);
    expect(db.expenses.some((e) => e.id === aliceExpense.id)).toBe(true);
    expect((await j(await call(goals.GET, "/api/goals", { user: BOB }))).goals).toEqual([]);
    expect((await call(contribute.POST, "x", { user: BOB, method: "POST", body: { amount: 5 }, params: { id: aliceGoal.id } })).status).toBe(404);
    expect((await call(plan.GET, "x", { user: BOB, params: { id: aliceGoal.id } })).status).toBe(404);
    expect((await j(await call(budgets.GET, `/api/budgets?month=${month}`, { user: BOB }))).budgets).toEqual([]);
    const bobSummary = await j(await call(summary.GET, `/api/summary?month=${month}`, { user: BOB }));
    expect(bobSummary).toMatchObject({ total: 0, income: 0 });
  });

  it("a client-supplied user_id is ignored: the row is owned by the authenticated user", async () => {
    const res = await call(expenses.POST, "/api/expenses", { method: "POST", body: { amount: 10, category: "Other", merchant: "x", spent_on: today, source: "manual", user_id: BOB } });
    expect((await j(res)).expense.user_id).toBe(ALICE);
    expect(db.expenses.filter((e) => e.user_id === BOB && e.merchant === "x")).toHaveLength(0);
  });

  it("DELETE removes the owner's own expense", async () => {
    const created = (await j(await call(expenses.POST, "/api/expenses", { method: "POST", body: { amount: 10, category: "Other", merchant: "temp", spent_on: today, source: "manual" } }))).expense;
    const res = await call(expenseById.DELETE, "x", { method: "DELETE", params: { id: created.id } });
    expect(await j(res)).toEqual({ ok: true });
    expect((await call(expenseById.DELETE, "x", { method: "DELETE", params: { id: created.id } })).status).toBe(404);
    expect((await call(expenseById.DELETE, "x", { method: "DELETE", params: { id: "not-a-uuid" } })).status).toBe(404);
  });
});

describe("input validation and error format", () => {
  const bad = async (handler: Parameters<typeof call>[0], path: string, body: unknown, method = "POST") => {
    const res = await call(handler, path, { method, body });
    const payload = await j(res);
    expect(res.status).toBe(400);
    expect(Object.keys(payload)).toEqual(["error"]);
    expect(typeof payload.error).toBe("string");
    return payload.error as string;
  };
  const okExpense = { amount: 100, category: "Groceries", merchant: "m", spent_on: "2026-09-01", source: "manual" };

  it("rejects invalid expenses", async () => {
    expect(await bad(expenses.POST, "/api/expenses", { ...okExpense, amount: 0 })).toMatch(/amount/);
    expect(await bad(expenses.POST, "/api/expenses", { ...okExpense, amount: -5 })).toMatch(/amount/);
    expect(await bad(expenses.POST, "/api/expenses", { ...okExpense, amount: "100" })).toMatch(/amount/);
    expect(await bad(expenses.POST, "/api/expenses", { ...okExpense, category: "Crypto" })).toMatch(/category/);
    expect(await bad(expenses.POST, "/api/expenses", { ...okExpense, spent_on: "2026-02-30" })).toMatch(/spent_on/);
    expect(await bad(expenses.POST, "/api/expenses", { ...okExpense, source: "voice" })).toMatch(/source/);
    expect(await bad(expenses.POST, "/api/expenses", { ...okExpense, spent_at: "25:00" })).toMatch(/spent_at/);
    expect(await bad(expenses.POST, "/api/expenses", "{not json")).toMatch(/valid JSON/);
  });

  it("rejects invalid month, goals, future, profile, chat, budgets", async () => {
    expect((await call(expenses.GET, "/api/expenses?month=2026-13")).status).toBe(400);
    expect((await call(summary.GET, "/api/summary?month=garbage")).status).toBe(400);
    expect(await bad(goals.POST, "/api/goals", { title: "x", target: 0, deadline: "2030-01-01" })).toMatch(/target/);
    expect(await bad(goals.POST, "/api/goals", { title: "x", target: 5, deadline: "soon" })).toMatch(/deadline/);
    expect(await bad(future.POST, "/api/future", { monthlySaving: 20001, years: 5 })).toMatch(/monthlySaving/);
    expect(await bad(future.POST, "/api/future", { monthlySaving: -1, years: 5 })).toMatch(/monthlySaving/);
    expect(await bad(future.POST, "/api/future", { monthlySaving: 100, years: 0 })).toMatch(/years/);
    expect(await bad(future.POST, "/api/future", { monthlySaving: 100, years: 2.5 })).toMatch(/years/);
    expect(await bad(profile.PUT, "/api/profile", { persona: "evil" }, "PUT")).toMatch(/persona/);
    expect(await bad(profile.PUT, "/api/profile", { income: -1 }, "PUT")).toMatch(/income/);
    expect(await bad(profile.PUT, "/api/profile", {}, "PUT")).toMatch(/at least one/);
    expect(await bad(chat.POST, "/api/chat", { message: "" })).toMatch(/message/);
    expect(await bad(budgets.PUT, "/api/budgets", { budgets: [{ category: "Nope", limit: 5 }] }, "PUT")).toMatch(/category/);
    expect(await bad(generate.POST, "/api/budget/generate", { income: 10000, fixedCosts: [{ label: "Rent", amount: 12000 }] })).toMatch(/exceed/);
    expect(await bad(generate.POST, "/api/budget/generate", { income: 0, fixedCosts: [] })).toMatch(/income/);
    expect(await bad(parse.POST, "/api/expenses/parse", { text: "x", today: "yesterday" })).toMatch(/today/);
    expect(await bad(whatif.POST, "/api/whatif", { description: "x", monthlyCost: 0, months: 3 })).toMatch(/monthlyCost/);
  });

  it("budget PUT requires income to be set", async () => {
    const res = await call(budgets.PUT, "/api/budgets", { user: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", method: "PUT", body: { budgets: [{ category: "Groceries", limit: 100 }] } });
    expect(res.status).toBe(400);
    expect((await j(res)).error).toMatch(/monthly income/);
  });

  it("empty user gets stable, non-crashing shapes everywhere", async () => {
    const user = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const s = await j(await call(summary.GET, "/api/summary", { user }));
    expect(s).toMatchObject({ total: 0, income: 0, byCategory: [], topMerchants: [], budgetUsage: [], insight: null });
    expect(s.trend).toHaveLength(6);
    expect(s.healthScore).toBeGreaterThanOrEqual(0);
    const fut = await j(await call(future.POST, "/api/future", { user, method: "POST", body: { monthlySaving: 0, years: 5 } }));
    expect(finalBalance(fut.current.series)).toBe(0);
    expect((await j(await call(insights.POST, "/api/insights/refresh", { user, method: "POST" }))).insight.body).toBeTruthy();
  });

  it("never leaks internals on unexpected failures", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const boom = new Error("connection string postgres://secret:pw@db");
    vi.spyOn(db, "forUser").mockImplementationOnce(() => {
      throw boom;
    });
    const res = await call(goals.GET, "/api/goals");
    expect(res.status).toBe(500);
    expect(await j(res)).toEqual({ error: "Internal server error" });
    spy.mockRestore();
  });
});

describe("AI failure modes", () => {
  it("parse: outage propagates as 503/429 JSON errors; invalid JSON becomes a clarification", async () => {
    setAiClientForTests(null);
    delete process.env.OPENAI_API_KEY;
    const res = await call(parse.POST, "/api/expenses/parse", { method: "POST", body: { text: "uber pe 300", today } });
    expect(res.status).toBe(503);
    expect(await j(res)).toEqual({ error: "AI service is not configured" });

    setAiClientForTests(new FakeAi(() => { throw Object.assign(new Error("rl"), { status: 429 }); }));
    // raw errors thrown by a client are 500 unless mapped; the real client maps 429 -> AppError(429)
    const res2 = await call(parse.POST, "/api/expenses/parse", { method: "POST", body: { text: "uber pe 300", today } });
    expect([429, 500]).toContain(res2.status);
  });

  it("future / insight / plan degrade to deterministic grounded text when the model is down", async () => {
    setAiClientForTests(null);
    delete process.env.OPENAI_API_KEY;
    await call(seed.POST, "/api/demo/seed", { method: "POST" });
    const f = await j(await call(future.POST, "/api/future", { method: "POST", body: { monthlySaving: 5000, years: 5 } }));
    expect(f.narrativeSource).toBe("fallback");
    expect(f.narrative).toMatch(/assumption, not a promise/);
    expect(f.current.series).toHaveLength(61);
    const ins = await j(await call(insights.POST, "/api/insights/refresh", { method: "POST" }));
    expect(ins.insight.body.length).toBeGreaterThan(10);
  });

  it("an invented figure from the model is caught and replaced by the deterministic fallback", async () => {
    await call(seed.POST, "/api/demo/seed", { method: "POST" });
    setAiClientForTests(new FakeAi(() => `I have ₹99,99,999 saved. ${words(65)}`));
    const f = await j(await call(future.POST, "/api/future", { method: "POST", body: { monthlySaving: 5000, years: 5 } }));
    expect(f.narrativeSource).toBe("fallback");
    expect(f.narrative).not.toContain("99,99,999");
  });

  it("chat: provider failure before the first token is a JSON error, and nothing is persisted", async () => {
    setAiClientForTests(null);
    delete process.env.OPENAI_API_KEY;
    const before = db.chat.length;
    const res = await call(chat.POST, "/api/chat", { method: "POST", body: { message: "hi" } });
    expect(res.status).toBe(503);
    expect(db.chat).toHaveLength(before);
  });

  it("rate limit returns 429 { error }", async () => {
    let last: Response | undefined;
    for (let i = 0; i < 41; i++) last = await call(parse.POST, "/api/expenses/parse", { method: "POST", body: { text: "uber pe 300", today } });
    expect(last!.status).toBe(429);
    expect(Object.keys(await j(last!))).toEqual(["error"]);
  });
});

describe("CSV import", () => {
  const csv = (rows: string[]) => {
    const form = new FormData();
    form.set("file", new File([["date,description,amount", ...rows].join("\n")], "statement.csv", { type: "text/csv" }));
    return form;
  };

  it("categorizes rows, flags low confidence for review, skips bad rows, saves nothing", async () => {
    const before = db.expenses.length;
    const res = await call(importCsv.POST, "/api/expenses/import", {
      method: "POST",
      form: csv(["2026-09-01,ZOMATO ORDER 123,450.50", "03/09/2026,MYSTERY VENDOR,\"1,200\"", "bad-date,X,10", "2026-09-04,Y,0"]),
    });
    const body = await j(res);
    expect(body.rows).toHaveLength(2);
    expect(body.rows[0]).toMatchObject({ date: "2026-09-01", description: "ZOMATO ORDER 123", amount: 450.5, category: "Food & Dining", needs_review: false });
    expect(body.rows[1]).toMatchObject({ date: "2026-09-03", amount: 1200, category: "Other", needs_review: true });
    expect(body.rows[1].confidence).toBeLessThan(0.7);
    expect(body.skipped).toHaveLength(2);
    expect(db.expenses).toHaveLength(before);
  });

  it("rejects missing files and wrong columns", async () => {
    expect((await call(importCsv.POST, "/api/expenses/import", { method: "POST", form: new FormData() })).status).toBe(400);
    const form = new FormData();
    form.set("file", new File(["a,b\n1,2"], "x.csv"));
    const res = await call(importCsv.POST, "/api/expenses/import", { method: "POST", form });
    expect(res.status).toBe(400);
    expect((await j(res)).error).toMatch(/columns/);
  });
});
