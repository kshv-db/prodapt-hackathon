import { describe, expect, it } from "vitest";
import { CATEGORIES } from "@/lib/finance/categories";
import { generateBudget, inferFixedCostCategory } from "@/lib/finance/budget";

const fixedCosts = [
  { name: "Rent", amount: 12_000 },
  { name: "Phone EMI", amount: 2_000 },
  { name: "Wifi", amount: 1_000 },
];

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("generateBudget", () => {
  it("returns every category once with a non-empty reason and non-negative limits", () => {
    const r = generateBudget({ income: 45_000, fixedCosts, history: [] });
    expect(r.budgets.map((b) => b.category)).toEqual([...CATEGORIES]);
    for (const b of r.budgets) {
      expect(b.limit).toBeGreaterThanOrEqual(0);
      expect(b.reason.length).toBeGreaterThan(0);
    }
  });

  it("income = category limits + savings line (exactly), so limits never exceed income", () => {
    for (const income of [15_000, 45_000, 80_000, 500_000]) {
      const r = generateBudget({ income, fixedCosts: [{ name: "Rent", amount: Math.min(income / 3, 12_000) }], history: [] });
      const limits = sum(r.budgets.map((b) => b.limit));
      expect(limits).toBeLessThanOrEqual(income);
      expect(Math.round((limits + r.savings.limit) * 100)).toBe(income * 100);
    }
  });

  it("always includes a savings line, at least the 20% target when affordable", () => {
    const r = generateBudget({ income: 45_000, fixedCosts, history: [] });
    expect(r.savings.limit).toBeGreaterThanOrEqual(9_000);
    expect(r.savings.reason).toMatch(/savings/);
    expect(r.totals.savings).toBe(r.savings.limit);
  });

  it("fixed costs are honoured exactly inside their category", () => {
    const r = generateBudget({ income: 45_000, fixedCosts, history: [] });
    expect(r.budgets.find((b) => b.category === "Rent & EMI")!.limit).toBeGreaterThanOrEqual(14_000);
    expect(r.budgets.find((b) => b.category === "Bills & Utilities")!.limit).toBeGreaterThanOrEqual(1_000);
    expect(r.totals.fixedCosts).toBe(15_000);
  });

  it("uses history: discretionary trimmed 10%, essentials kept", () => {
    const r = generateBudget({
      income: 60_000,
      fixedCosts: [],
      history: [
        { category: "Food & Dining", avg: 5_000 },
        { category: "Groceries", avg: 4_000 },
      ],
    });
    expect(r.budgets.find((b) => b.category === "Food & Dining")!.limit).toBe(4_500);
    expect(r.budgets.find((b) => b.category === "Groceries")!.limit).toBe(4_000);
  });

  it("scales limits down proportionally when history exceeds what is affordable", () => {
    const r = generateBudget({
      income: 20_000,
      fixedCosts: [{ name: "Rent", amount: 10_000 }],
      history: [
        { category: "Food & Dining", avg: 10_000 },
        { category: "Shopping", avg: 10_000 },
      ],
    });
    const limits = sum(r.budgets.map((b) => b.limit));
    expect(limits).toBeLessThanOrEqual(20_000 - 4_000 + 1); // 20% savings target preserved
    expect(r.savings.limit).toBeGreaterThanOrEqual(4_000);
  });

  it("fixed costs equal to income leave zero flexible budget and zero savings", () => {
    const r = generateBudget({ income: 20_000, fixedCosts: [{ name: "Rent", amount: 20_000 }], history: [] });
    expect(r.savings.limit).toBe(0);
    expect(sum(r.budgets.map((b) => b.limit))).toBe(20_000);
  });

  it("rejects invalid inputs", () => {
    expect(() => generateBudget({ income: 0, fixedCosts: [], history: [] })).toThrow(/income/);
    expect(() => generateBudget({ income: -5, fixedCosts: [], history: [] })).toThrow();
    expect(() => generateBudget({ income: Number.NaN, fixedCosts: [], history: [] })).toThrow();
    expect(() => generateBudget({ income: 10_000, fixedCosts: [{ name: "Rent", amount: 12_000 }], history: [] })).toThrow(/exceed/);
    expect(() => generateBudget({ income: 10_000, fixedCosts: [{ name: "x", amount: -1 }], history: [] })).toThrow();
  });

  it("is deterministic", () => {
    const a = generateBudget({ income: 45_000, fixedCosts, history: [{ category: "Food & Dining", avg: 4_000 }] });
    const b = generateBudget({ income: 45_000, fixedCosts, history: [{ category: "Food & Dining", avg: 4_000 }] });
    expect(a).toEqual(b);
  });

  it("an explicit fixed-cost category overrides keyword inference", () => {
    const r = generateBudget({ income: 30_000, fixedCosts: [{ name: "Gym", amount: 1_000, category: "Entertainment" }], history: [] });
    expect(r.budgets.find((b) => b.category === "Entertainment")!.limit).toBeGreaterThanOrEqual(1_000);
  });
});

describe("inferFixedCostCategory", () => {
  it.each([
    ["House Rent", "Rent & EMI"],
    ["Bike EMI", "Rent & EMI"],
    ["Netflix", "Subscriptions"],
    ["Electricity bill", "Bills & Utilities"],
    ["something odd", "Bills & Utilities"],
  ])("%s -> %s", (name, cat) => expect(inferFixedCostCategory(name)).toBe(cat));
});
