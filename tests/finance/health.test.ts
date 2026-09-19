import { describe, expect, it } from "vitest";
import { calculateHealthScore, type HealthInput } from "@/lib/finance/health";

const base: HealthInput = {
  income: 50_000,
  savingsRate: 0.2,
  budgetLines: [{ category: "Food & Dining", limit: 8_000, spent: 5_000 }],
  goalsOnTrack: [true, true],
  lateNightDiscretionary: 0,
  totalSpent: 30_000,
};
const score = (o: Partial<HealthInput> = {}) => calculateHealthScore({ ...base, ...o });

describe("calculateHealthScore", () => {
  it("perfect inputs give 100", () => {
    const r = score();
    expect(r.score).toBe(100);
    expect(r.components.savings.points).toBe(40);
    expect(r.components.budget.points).toBe(30);
    expect(r.components.goals.points).toBe(20);
    expect(r.components.impulse.points).toBe(10);
  });

  it("0% savings rate loses all 40 savings points", () => {
    const r = score({ savingsRate: 0 });
    expect(r.components.savings.points).toBe(0);
    expect(r.score).toBe(60);
  });

  it("20%+ savings rate earns full marks and more does not exceed 40", () => {
    expect(score({ savingsRate: 0.2 }).components.savings.points).toBe(40);
    expect(score({ savingsRate: 0.6 }).components.savings.points).toBe(40);
  });

  it("savings points scale linearly: 10% => 20", () => {
    expect(score({ savingsRate: 0.1 }).components.savings.points).toBe(20);
  });

  it("over-budget category loses points in proportion to the overspend", () => {
    const r = score({ budgetLines: [{ category: "Food & Dining", limit: 4_000, spent: 5_000 }] });
    expect(r.components.budget.points).toBe(22.5); // 30 * (1 - 1000/4000)
    expect(r.components.budget.fact).toMatch(/1 category over budget/);
  });

  it("massive overspend floors budget points at 0", () => {
    expect(score({ budgetLines: [{ category: "Other", limit: 100, spent: 100_000 }] }).components.budget.points).toBe(0);
  });

  it("no budget set gives neutral half points instead of a free 30", () => {
    const r = score({ budgetLines: [] });
    expect(r.components.budget.points).toBe(15);
    expect(r.components.budget.fact).toMatch(/No budget/);
  });

  it("goals: points are the share of goals on track", () => {
    expect(score({ goalsOnTrack: [true, false] }).components.goals.points).toBe(10);
    expect(score({ goalsOnTrack: [false, false] }).components.goals.points).toBe(0);
    expect(score({ goalsOnTrack: [true, true] }).components.goals.points).toBe(20);
  });

  it("no goals gives neutral half points", () => {
    expect(score({ goalsOnTrack: [] }).components.goals.points).toBe(10);
  });

  it("late-night discretionary spend under 10% keeps full impulse points (boundary 10%)", () => {
    expect(score({ lateNightDiscretionary: 2_999, totalSpent: 30_000 }).components.impulse.points).toBe(10);
    expect(score({ lateNightDiscretionary: 3_000, totalSpent: 30_000 }).components.impulse.points).toBe(10);
  });

  it("heavy late-night spend loses impulse points, down to 0 at 30%", () => {
    expect(score({ lateNightDiscretionary: 6_000, totalSpent: 30_000 }).components.impulse.points).toBe(5); // 20%
    expect(score({ lateNightDiscretionary: 9_000, totalSpent: 30_000 }).components.impulse.points).toBe(0); // 30%
    expect(score({ lateNightDiscretionary: 20_000, totalSpent: 30_000 }).components.impulse.points).toBe(0);
  });

  it("no spending: impulse is full, no division by zero", () => {
    const r = score({ totalSpent: 0, lateNightDiscretionary: 0 });
    expect(r.components.impulse.points).toBe(10);
    expect(Number.isFinite(r.score)).toBe(true);
  });

  it("unknown income scores savings as 0 and explains why", () => {
    const r = score({ income: 0, savingsRate: 0 });
    expect(r.components.savings.points).toBe(0);
    expect(r.components.savings.fact).toMatch(/income not set/i);
  });

  it("score is always an integer within 0-100", () => {
    const worst = score({ savingsRate: 0, budgetLines: [{ category: "x", limit: 1, spent: 1e9 }], goalsOnTrack: [false], lateNightDiscretionary: 1, totalSpent: 1 });
    expect(worst.score).toBe(0);
    expect(Number.isInteger(score({ savingsRate: 0.137 }).score)).toBe(true);
  });

  it("reason is deterministic and names the biggest drag", () => {
    const r = score({ savingsRate: 0.05, lateNightDiscretionary: 9_000 });
    expect(r.reason).toContain(`Score ${r.score}/100`);
    expect(r.reason).toMatch(/Saving 5% of income/); // 30 points lost on savings > 10 on impulse
    expect(score().reason).toMatch(/everything else is on track/);
    expect(calculateHealthScore({ ...base, savingsRate: 0.05, lateNightDiscretionary: 9_000 }).reason).toBe(r.reason);
  });
});
