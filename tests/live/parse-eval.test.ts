import { describe, expect, it } from "vitest";
import { parseExpenseText } from "@/lib/ai/expense-parser";
import type { Category } from "@/lib/finance/categories";

/**
 * PRD success criterion: at least 18 of 20 sample phrases parse correctly.
 * This talks to the REAL OpenAI API, so it only runs when OPENAI_API_KEY is set:
 *   OPENAI_API_KEY=... npx vitest run tests/live
 * (Skipped in CI/offline; it has not been executed in the environment this backend was built in.)
 */
const TODAY = "2026-09-19"; // a Saturday

const PHRASES: { text: string; amount: number; category: Category; on: string }[] = [
  { text: "Spent 450 on Zomato yesterday", amount: 450, category: "Food & Dining", on: "2026-09-18" },
  { text: "kal Zomato pe 450 diye", amount: 450, category: "Food & Dining", on: "2026-09-18" },
  { text: "uber pe 300", amount: 300, category: "Transport", on: TODAY },
  { text: "today groceries 1200", amount: 1200, category: "Groceries", on: TODAY },
  { text: "aaj chai pe 40 kharch kiye", amount: 40, category: "Food & Dining", on: TODAY },
  { text: "Netflix subscription 649 paid", amount: 649, category: "Subscriptions", on: TODAY },
  { text: "parso Amazon se shoes liye 2,499 ke", amount: 2499, category: "Shopping", on: "2026-09-17" },
  { text: "electricity bill 1,850 last friday", amount: 1850, category: "Bills & Utilities", on: "2026-09-18" },
  { text: "movie tickets BookMyShow 600 3 days ago", amount: 600, category: "Entertainment", on: "2026-09-16" },
  { text: "auto ka kiraya 80", amount: 80, category: "Transport", on: TODAY },
  { text: "bought medicines 520 at Apollo", amount: 520, category: "Health", on: TODAY },
  { text: "school fees 12000 paid today", amount: 12000, category: "Education", on: TODAY },
  { text: "rent 12000 diya", amount: 12000, category: "Rent & EMI", on: TODAY },
  { text: "Swiggy pe kal raat 380 ka order", amount: 380, category: "Food & Dining", on: "2026-09-18" },
  { text: "petrol 500 bharwaya", amount: 500, category: "Transport", on: TODAY },
  { text: "flight ticket 4.5k for goa trip", amount: 4500, category: "Travel", on: TODAY },
  { text: "Spotify 119", amount: 119, category: "Subscriptions", on: TODAY },
  { text: "phone recharge 299 Jio", amount: 299, category: "Bills & Utilities", on: TODAY },
  { text: "BigBasket se sabzi 780 ki", amount: 780, category: "Groceries", on: TODAY },
  { text: "dinner at Barbeque Nation 2400 yesterday", amount: 2400, category: "Food & Dining", on: "2026-09-18" },
];

describe.skipIf(!process.env.OPENAI_API_KEY)("live: expense parsing accuracy (PRD F1: >= 18/20)", () => {
  it("parses at least 18 of 20 sample phrases correctly", async () => {
    const results = await Promise.all(PHRASES.map(async (p) => ({ p, r: await parseExpenseText(p.text, TODAY) })));
    const correct = results.filter(({ p, r }) => r.amount === p.amount && r.category === p.category && r.spent_on === p.on && !r.needs_clarification);
    const wrong = results.filter((x) => !correct.includes(x)).map(({ p, r }) => ({ text: p.text, got: r }));
    console.log(`parsed correctly: ${correct.length}/20`, JSON.stringify(wrong, null, 1));
    expect(correct.length).toBeGreaterThanOrEqual(18);
  }, 120_000);

  it("asks instead of guessing when the amount is missing", async () => {
    for (const text of ["Zomato pe kal paisa diye", "bought coffee yesterday"]) {
      const r = await parseExpenseText(text, TODAY);
      expect(r.amount).toBe(0);
      expect(r.needs_clarification).toBeTruthy();
    }
  }, 60_000);
});
