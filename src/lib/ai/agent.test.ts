import { afterEach, describe, expect, it, vi } from "vitest";
import { runAgent, toolDefinitions, type LlmFn, type LlmReply } from "./agent";
import { resolvePersona } from "./personas";
import type { AgentEvent } from "./types";
import { makeFacts, makeTools } from "./fixtures";

afterEach(() => vi.unstubAllEnvs());

function script(...replies: LlmReply[]) {
  let i = 0;
  const calls: number[] = [];
  const llm: LlmFn = async () => {
    calls.push(i);
    const reply = replies[i++];
    if (!reply) throw new Error("script exhausted");
    return reply;
  };
  return { llm, calls };
}

const say = (content: string): LlmReply => ({ content, toolCalls: [] });
const call = (name: string, args: unknown, id = "c1"): LlmReply => ({
  content: null,
  toolCalls: [{ id, name, arguments: JSON.stringify(args) }],
});

async function collect(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}
const text = (events: AgentEvent[]) =>
  events.flatMap((e) => (e.type === "token" ? [e.text] : [])).join("");

function run(llm: LlmFn | undefined, message: string, facts = makeFacts()) {
  const { tools, calls } = makeTools();
  const events = collect(runAgent({ message, history: [], facts, userId: "session-user", tools, llm }));
  return { events, calls };
}

describe("runAgent", () => {
  it("saves an expense, streams steps, offers undo and answers from computed figures", async () => {
    const { llm } = script(
      call("add_expense", { amount: 450, category: "Food & Dining", merchant: "Zomato", spent_on: "2026-09-18" }),
      say("Saved ₹450 for Zomato. Food is at 82% of its limit."),
    );
    const { events, calls } = run(llm, "kal Zomato pe 450 diye");
    const ev = await events;

    expect(calls[0]).toMatchObject({ fn: "add_expense", userId: "session-user" });
    expect(ev.filter((e) => e.type === "step").map((e) => (e as { status: string }).status)).toEqual([
      "running",
      "done",
    ]);
    expect(ev.some((e) => e.type === "undo")).toBe(true);
    expect(text(ev)).toBe("Saved ₹450 for Zomato. Food is at 82% of its limit.");
    expect(ev.at(-1)).toEqual({ type: "done" });
    expect(ev[0]).toEqual({ type: "mood", mood: "thinking" });
  });

  it("only proposes a budget change and emits a confirm card", async () => {
    const { llm } = script(
      call("update_budget", { category: "Food & Dining", limit: 6000 }),
      say("Prepared it. Tap Confirm to set Food & Dining to ₹6,000."),
    );
    const { events, calls } = run(llm, "Food ka budget 6000 kar do");
    const ev = await events;

    expect(calls.map((c) => c.fn)).toEqual(["propose:update_budget"]);
    const confirm = ev.find((e) => e.type === "confirm");
    expect(confirm).toMatchObject({ type: "confirm", actionId: "act-1", tool: "update_budget" });
  });

  it("rejects invalid tool arguments without touching the backend", async () => {
    const { llm } = script(
      call("add_expense", { amount: -5, category: "Food & Dining", spent_on: "2026-09-18" }),
      say("Sorry, that did not go through."),
    );
    const { events, calls } = run(llm, "spent minus five");
    const ev = await events;

    expect(calls).toEqual([]);
    expect(ev.some((e) => e.type === "step" && e.status === "error")).toBe(true);
  });

  it("rejects unknown tools", async () => {
    const { llm } = script(call("drop_database", {}), say("I cannot do that."));
    const { events, calls } = run(llm, "delete everything");
    const ev = await events;
    expect(calls).toEqual([]);
    expect(ev.some((e) => e.type === "step" && e.status === "error")).toBe(true);
  });

  it("never lets the model choose the user id", async () => {
    const { llm } = script(
      call("add_expense", {
        amount: 40,
        category: "Food & Dining",
        spent_on: "2026-09-19",
        userId: "attacker",
      }),
      say("Saved ₹40."),
    );
    const { events, calls } = run(llm, "chai 40");
    await events;

    expect(calls[0].userId).toBe("session-user");
    expect(JSON.stringify(calls[0].args)).not.toContain("attacker");
  });

  it("rewrites once when the answer contains an invented figure", async () => {
    const { llm, calls: llmCalls } = script(say("You will save ₹9,999 more."), say("Food is at 82% of its limit."));
    const { events } = run(llm, "how am I doing?");
    const ev = await events;
    expect(text(ev)).toBe("Food is at 82% of its limit.");
    expect(llmCalls).toHaveLength(2);
  });

  it("falls back when the rewrite is still ungrounded", async () => {
    const { llm } = script(say("You will save ₹9,999 more."), say("Still ₹8,888."));
    const { events } = run(llm, "how am I doing?");
    const ev = await events;
    expect(text(ev)).toMatch(/could not verify/i);
    expect(text(ev)).not.toContain("9,999");
    expect(text(ev)).not.toContain("8,888");
  });

  it("reports an error event when the model call fails", async () => {
    const failing: LlmFn = async () => {
      throw new Error("boom");
    };
    const { events } = run(failing, "hi");
    const ev = await events;
    expect(ev.map((e) => e.type)).toEqual(["mood", "error", "mood", "done"]);
  });

  it("shows a smirk for roast users with a budget alert, worried otherwise", async () => {
    const roast = makeFacts({ profile: { name: "A", monthlyIncome: 15000, persona: "roast", language: "en" } });
    const a = await run(script(say("Food is at 82%.")).llm, "hi", roast).events;
    const b = await run(script(say("Food is at 82%.")).llm, "hi").events;
    expect(a.find((e) => e.type === "mood" && e.mood !== "thinking")).toEqual({ type: "mood", mood: "smirk" });
    expect(b.find((e) => e.type === "mood" && e.mood !== "thinking")).toEqual({ type: "mood", mood: "worried" });
  });

  it("emits a projection chart for run_projection", async () => {
    const { llm } = script(
      call("run_projection", { monthlySaving: 5000, years: 5 }),
      say("At ₹5,000 a month you would have ₹3,58,000 in 5 years, assuming 7% returns."),
    );
    const { events } = run(llm, "what if I save 5000?");
    const ev = await events;
    expect(ev.find((e) => e.type === "ui")).toMatchObject({ component: "future_chart" });
  });
});

describe("runAgent in mock mode", () => {
  it("saves each expense in a two-expense message through the real executors", async () => {
    vi.stubEnv("AI_MOCK", "1");
    const { events, calls } = run(undefined, "kal Zomato pe 450 aur aaj chai pe 40 diye");
    const ev = await events;

    const adds = calls.filter((c) => c.fn === "add_expense");
    expect(adds).toHaveLength(2);
    expect(adds[0].args).toMatchObject({ amount: 450, category: "Food & Dining", spent_on: "2026-09-18" });
    expect(adds[1].args).toMatchObject({ amount: 40, spent_on: "2026-09-19" });
    expect(ev.filter((e) => e.type === "undo")).toHaveLength(2);
    expect(ev.at(-1)).toEqual({ type: "done" });
  });

  it("returns a confirm card for a budget change", async () => {
    vi.stubEnv("AI_MOCK", "1");
    const { events, calls } = run(undefined, "Food ka budget 6000 kar do");
    const ev = await events;
    expect(calls.map((c) => c.fn)).toEqual(["propose:update_budget"]);
    expect(calls[0].args).toEqual({ category: "Food & Dining", limit: 6000 });
    expect(ev.some((e) => e.type === "confirm")).toBe(true);
  });

  it("does not log expenses when the user asks a question", async () => {
    vi.stubEnv("AI_MOCK", "1");
    const { events, calls } = run(undefined, "How am I doing?");
    await events;
    expect(calls).toEqual([]);
  });

  it("runs a what-if check for a purchase", async () => {
    vi.stubEnv("AI_MOCK", "1");
    const { events, calls } = run(undefined, "agar main 2500 ki EMI 12 mahine ke liye lu to?");
    const ev = await events;
    expect(calls.map((c) => c.fn)).toEqual(["run_what_if"]);
    expect(calls[0].args).toMatchObject({ monthlyCost: 2500, months: 12 });
    expect(text(ev)).toMatch(/Laptop goal slips by 8 months/);
  });

  it("suggests savings, lists recent expenses, and switches persona", async () => {
    vi.stubEnv("AI_MOCK", "1");
    const a = run(undefined, "Where can I save?");
    await a.events;
    expect(a.calls.map((c) => c.fn)).toEqual(["suggest_savings"]);

    const b = run(undefined, "show my recent expenses");
    await b.events;
    expect(b.calls.map((c) => c.fn)).toEqual(["list_recent_expenses"]);

    const c = run(undefined, "roast mode on kar do");
    await c.events;
    expect(c.calls).toEqual([{ fn: "set_persona", userId: "session-user", args: { persona: "roast" } }]);
  });

  it("proposes a generated budget through a confirm card", async () => {
    vi.stubEnv("AI_MOCK", "1");
    const { events, calls } = run(undefined, "mera budget banao");
    const ev = await events;
    expect(calls.map((c) => c.fn)).toEqual(["propose:generate_budget"]);
    expect(ev.some((e) => e.type === "confirm")).toBe(true);
  });
});

describe("runAgent with the newer tools", () => {
  it("deletes an expense only through a confirm card, after looking up its id", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const { llm } = script(
      call("list_recent_expenses", { limit: 5 }),
      call("delete_expense", { expenseId: id }, "c2"),
      say("I prepared removing that Zomato expense. Tap Confirm."),
    );
    const { events, calls } = run(llm, "last Zomato order delete kar do");
    const ev = await events;
    expect(calls.map((c) => c.fn)).toEqual(["list_recent_expenses", "propose:delete_expense"]);
    expect(calls[1].args).toEqual({ expenseId: id });
    expect(ev.some((e) => e.type === "confirm")).toBe(true);
  });

  it("answers a what-if from computed figures only", async () => {
    const { llm } = script(
      call("run_what_if", { description: "phone EMI", monthlyCost: 2500, months: 12 }),
      say("That is ₹30,000 in total, and your Laptop goal slips by 8 months."),
    );
    const { events } = run(llm, "phone EMI pe loon?");
    const ev = await events;
    expect(text(ev)).toMatch(/₹30,000/);
  });
});

describe("tool definitions", () => {
  it("exposes the 14 contract tools and no user id parameter", () => {
    const defs = toolDefinitions();
    expect(defs.map((d) => d.function.name).sort()).toEqual(
      [
        "add_expense",
        "contribute_to_goal",
        "create_goal",
        "delete_expense",
        "generate_budget",
        "get_budget_status",
        "get_goals",
        "get_spending_summary",
        "list_recent_expenses",
        "run_projection",
        "run_what_if",
        "set_persona",
        "suggest_savings",
        "update_budget",
      ].sort(),
    );
    for (const d of defs) {
      expect(JSON.stringify(d.function.parameters)).not.toMatch(/userId|user_id|\$schema/);
    }
  });
});

describe("resolvePersona", () => {
  it("drops roast to friendly when spending exceeds income", () => {
    const distressed = makeFacts({ totals: { spent: 20000, saved: 0, savingsRatePct: 0 } });
    expect(resolvePersona("roast", distressed)).toBe("friendly");
    expect(resolvePersona("coach", distressed)).toBe("coach");
    expect(resolvePersona("roast", makeFacts())).toBe("roast");
  });
});
