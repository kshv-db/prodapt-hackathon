import { CATEGORIES, DISCRETIONARY, type Category } from "@/lib/finance/constants";
import type { BudgetLine, FixedCost } from "@/lib/finance/budget";
import type { Persona } from "./personas";
import type { FactSheet, NudgeTrigger, ProjectionFacts } from "./types";

/**
 * Deterministic stand-ins used when AI_MOCK=1. They are simple heuristics, not the real model:
 * good enough to build and demo the UI without an API key, and never call the network.
 */

export const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function weekdayOf(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

const KEYWORDS: [Category, string[]][] = [
  ["Subscriptions", ["netflix", "spotify", "prime", "hotstar", "youtube premium", "subscription"]],
  ["Food & Dining", ["food", "zomato", "swiggy", "chai", "lunch", "dinner", "breakfast", "pizza", "burger", "coffee", "cafe", "restaurant", "biryani", "snack"]],
  ["Groceries", ["grocer", "bigbasket", "blinkit", "zepto", "sabzi", "kirana"]],
  ["Transport", ["uber", "ola", "auto", "metro", "petrol", "fuel", "cab", "bus", "rapido"]],
  ["Travel", ["train", "flight", "hotel", "irctc", "trip"]],
  ["Shopping", ["amazon", "flipkart", "myntra", "headphone", "shoes", "clothes", "shirt", "gift"]],
  ["Bills & Utilities", ["electricity", "bill", "wifi", "recharge", "water", "gas"]],
  ["Rent & EMI", ["rent", "emi"]],
  ["Entertainment", ["movie", "cinema", "concert", "game"]],
  ["Health", ["medicine", "doctor", "apollo", "pharmacy", "hospital", "gym"]],
  ["Education", ["exam", "fees", "course", "udemy", "tuition"]],
];

const MERCHANTS = [
  "Zomato", "Swiggy", "Uber", "Ola", "Rapido", "Netflix", "Spotify", "Amazon", "Flipkart",
  "Myntra", "BigBasket", "Blinkit", "Zepto", "Apollo", "IRCTC",
];

export function mockCategory(description: string): Category {
  const lower = description.toLowerCase();
  for (const [category, words] of KEYWORDS) {
    if (words.some((w) => lower.includes(w))) return category;
  }
  return "Other";
}

export function mockParseExpense(input: string, today: string) {
  const lower = input.toLowerCase();

  const numbers = [...input.matchAll(/(₹|rs\.?\s?)?(\d[\d,]*(?:\.\d+)?)\s?(k\b)?/gi)].map((m) => ({
    value: Number(m[2].replace(/,/g, "")) * (m[3] ? 1000 : 1),
    hasCurrency: Boolean(m[1]),
  }));
  const afterTotal = /total\s*(?:₹|rs\.?\s?)?(\d[\d,]*(?:\.\d+)?)/i.exec(input);
  const ambiguous = /\b(ya|or)\b/i.test(input) && numbers.length >= 2;

  let amount: number | null = null;
  if (!ambiguous && numbers.length > 0) {
    if (afterTotal) amount = Number(afterTotal[1].replace(/,/g, ""));
    else {
      const withCurrency = numbers.find((n) => n.hasCurrency);
      amount = withCurrency ? withCurrency.value : Math.max(...numbers.map((n) => n.value));
    }
  }

  let spent_on = today;
  const lastDay = /last (sunday|monday|tuesday|wednesday|thursday|friday|saturday)/.exec(lower);
  if (/\b(kal|yesterday)\b/.test(lower)) spent_on = addDays(today, -1);
  else if (/\b(parso|day before yesterday)\b/.test(lower)) spent_on = addDays(today, -2);
  else if (lastDay) {
    const target = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"].indexOf(lastDay[1]);
    let back = (weekdayOf(today) - target + 7) % 7;
    if (back === 0) back = 7;
    spent_on = addDays(today, -back);
  }

  const merchant = MERCHANTS.find((m) => lower.includes(m.toLowerCase())) ?? "";
  return {
    amount,
    category: mockCategory(input),
    merchant,
    spent_on,
    confidence: amount === null ? 0.3 : 0.7,
    needs_clarification: amount === null ? "How much was it?" : null,
  };
}

export function mockCategorizeBatch(rows: { description: string; amount: number }[]) {
  return rows.map((r, index) => ({ index, category: mockCategory(r.description), confidence: 0.6 }));
}

export function mockProposeBudget(input: {
  income: number;
  fixedCosts: FixedCost[];
  averages: Record<string, number>;
}): BudgetLine[] {
  const known = new Set<string>(CATEGORIES);
  return Object.entries(input.averages)
    .filter(([category]) => known.has(category))
    .map(([category, avg]) => {
      const trimmed = (DISCRETIONARY as readonly string[]).includes(category);
      return {
        category,
        limit: Math.round((trimmed ? avg * 0.9 : avg) / 100) * 100,
        reason: trimmed
          ? `Your average is ${inr(avg)}; trimmed by 10%.`
          : `Kept near your average of ${inr(avg)}.`,
      };
    });
}

export function mockInsight(persona: Persona, f: FactSheet): string {
  const top = [...f.byCategory].sort((a, b) => b.spent - a.spent)[0];
  const lead = top
    ? `${top.category} is your biggest spend at ${inr(top.spent)} this month.`
    : `Your health score is ${f.health.score}.`;
  const tail: Record<Persona, string> = {
    friendly: "A small trim there and you'll feel the difference.",
    roast: "Bhai, is category ko thoda break de. Is hafte ek cap set kar.",
    coach: "Action: set a weekly cap for it today.",
  };
  return `${lead} ${tail[persona]}`;
}

export function mockNarrative(_persona: Persona, p: ProjectionFacts): string {
  const goal = p.goal ? `, jaise ${p.goal.title}` : "";
  return (
    `Main ${p.years} saal baad wala tu hoon. Tune har mahine ${inr(p.chosen.monthlySaving)} bachana shuru kiya, ` +
    `aur dekh, mere paas ${inr(p.chosen.endBalance)} hain, jabki purane raaste par sirf ${inr(p.current.endBalance)} hote. ` +
    `Fark ${inr(p.difference)} ka hai. Chhoti aadatein hi bade sapne poore karti hain${goal}. ` +
    `Yaad rakhna, ye projection ${p.annualReturnPct}% yearly return ki assumption par hai, koi promise nahi. ` +
    `Aaj hi shuru kar, main yahan tera intezaar kar raha hoon, aur mujhe pata hai tu kar sakta hai.`
  );
}

export function mockNudge(t: NudgeTrigger): string {
  return t.summary;
}

export function mockWhatIf(): string {
  return "This purchase eats into your budget and pushes your goal dates out. Check the numbers above before you decide.";
}
