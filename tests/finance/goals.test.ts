import { describe, expect, it } from "vitest";
import { calculateGoalPlan, suggestCut } from "@/lib/finance/goals";

const today = "2026-09-19";

describe("calculateGoalPlan", () => {
  it("normal goal: monthlyNeeded = remaining / monthsLeft, on track when savings cover it", () => {
    const plan = calculateGoalPlan({ target: 60_000, saved: 18_000, deadline: "2027-01-19" }, today, 12_000);
    expect(plan.status).toBe("active");
    expect(plan.remaining).toBe(42_000);
    expect(plan.monthsLeft).toBe(4);
    expect(plan.monthlyNeeded).toBe(10_500);
    expect(plan.onTrack).toBe(true);
    expect(plan.gap).toBe(0);
  });

  it("off track: reports the gap", () => {
    const plan = calculateGoalPlan({ target: 60_000, saved: 18_000, deadline: "2027-01-19" }, today, 9_000);
    expect(plan.onTrack).toBe(false);
    expect(plan.gap).toBe(1_500);
  });

  it("exactly meeting the requirement counts as on track", () => {
    expect(calculateGoalPlan({ target: 12_000, saved: 0, deadline: "2027-09-19" }, today, 1_000).onTrack).toBe(true);
  });

  it("completed goal (saved >= target): nothing needed, on track", () => {
    const plan = calculateGoalPlan({ target: 10_000, saved: 10_000, deadline: "2027-01-01" }, today, 0);
    expect(plan).toMatchObject({ status: "completed", remaining: 0, monthlyNeeded: 0, onTrack: true, gap: 0 });
  });

  it("over-funded goal never yields a negative remaining/monthlyNeeded", () => {
    const plan = calculateGoalPlan({ target: 10_000, saved: 15_000, deadline: "2027-01-01" }, today, 500);
    expect(plan.remaining).toBe(0);
    expect(plan.monthlyNeeded).toBe(0);
    expect(plan.status).toBe("completed");
  });

  it("completed goal stays completed even when its deadline has passed", () => {
    const plan = calculateGoalPlan({ target: 10_000, saved: 10_000, deadline: "2026-01-01" }, today, 0);
    expect(plan.status).toBe("completed");
    expect(plan.onTrack).toBe(true);
  });

  it("deadline today: zero months left, no division by zero, needs the full remainder", () => {
    const plan = calculateGoalPlan({ target: 10_000, saved: 4_000, deadline: today }, today, 2_000);
    expect(plan.status).toBe("due_today");
    expect(plan.monthsLeft).toBe(0);
    expect(plan.monthlyNeeded).toBe(6_000);
    expect(Number.isFinite(plan.monthlyNeeded)).toBe(true);
    expect(plan.onTrack).toBe(false);
    expect(plan.gap).toBe(4_000);
  });

  it("deadline today but savings already cover it: on track", () => {
    expect(calculateGoalPlan({ target: 10_000, saved: 4_000, deadline: today }, today, 6_000).onTrack).toBe(true);
  });

  it("expired goal is never on track and stays finite", () => {
    const plan = calculateGoalPlan({ target: 10_000, saved: 4_000, deadline: "2026-08-01" }, today, 999_999);
    expect(plan.status).toBe("expired");
    expect(plan.monthsLeft).toBe(0);
    expect(plan.onTrack).toBe(false);
    expect(plan.monthlyNeeded).toBe(6_000);
    expect(Number.isFinite(plan.gap)).toBe(true);
  });

  it("deadline within a month is treated as one month (never fractional/zero)", () => {
    const plan = calculateGoalPlan({ target: 3_000, saved: 0, deadline: "2026-10-01" }, today, 0);
    expect(plan.monthsLeft).toBe(1);
    expect(plan.monthlyNeeded).toBe(3_000);
  });

  it("zero savings is off track for any remaining amount", () => {
    expect(calculateGoalPlan({ target: 100, saved: 0, deadline: "2027-09-19" }, today, 0).onTrack).toBe(false);
  });

  it("negative savings are treated as zero", () => {
    const plan = calculateGoalPlan({ target: 1200, saved: 0, deadline: "2027-09-19" }, today, -500);
    expect(plan.gap).toBe(100);
  });
});

describe("suggestCut", () => {
  const averages = [
    { category: "Food & Dining", avg: 6_000 },
    { category: "Shopping", avg: 2_500 },
    { category: "Groceries", avg: 9_000 }, // essential: never suggested
    { category: "Rent & EMI", avg: 14_000 },
  ];

  it("picks the largest discretionary category and sizes the cut to the gap", () => {
    expect(suggestCut(1_500, averages)).toEqual({ category: "Food & Dining", amount: 1_500, closesGap: true });
  });

  it("rounds up to a clean 10 and caps at 50% of the category average", () => {
    expect(suggestCut(1_234, averages)).toEqual({ category: "Food & Dining", amount: 1_240, closesGap: true });
    expect(suggestCut(9_000, averages)).toEqual({ category: "Food & Dining", amount: 3_000, closesGap: false });
  });

  it("returns null when there is no gap or nothing to cut", () => {
    expect(suggestCut(0, averages)).toBeNull();
    expect(suggestCut(500, [])).toBeNull();
    expect(suggestCut(500, [{ category: "Groceries", avg: 5_000 }])).toBeNull();
  });
});
