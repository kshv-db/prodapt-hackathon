import { describe, expect, it } from "vitest";
import { aggregateSpend, calculateCategoryAverages, type ExpenseLike } from "@/lib/finance/aggregate";
import { addDays, addMonths, ceilMonthsBetween, isValidISODate, isValidMonth, lastNMonths, resolveDateHint, todayISO } from "@/lib/finance/dates";
import { formatINR, round2, sumMoney } from "@/lib/finance/money";
import { calculateSavingsBaseline } from "@/lib/finance/savings";
import { calculateWhatIf, monthsToReach } from "@/lib/finance/whatif";
import { isCategory, isLateNight } from "@/lib/finance/categories";

describe("dates", () => {
  it("validates real calendar dates only", () => {
    expect(isValidISODate("2026-02-28")).toBe(true);
    expect(isValidISODate("2026-02-30")).toBe(false);
    expect(isValidISODate("2026-13-01")).toBe(false);
    expect(isValidISODate("26-01-01")).toBe(false);
    expect(isValidISODate(20260101)).toBe(false);
    expect(isValidMonth("2026-09")).toBe(true);
    expect(isValidMonth("2026-00")).toBe(false);
  });

  it("month arithmetic crosses year boundaries", () => {
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-11", 3)).toBe("2027-02");
    expect(lastNMonths("2026-02", 6)).toEqual(["2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02"]);
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
  });

  it("todayISO uses the Asia/Kolkata calendar day", () => {
    expect(todayISO(new Date("2026-09-18T20:00:00Z"))).toBe("2026-09-19"); // 01:30 IST next day
    expect(todayISO(new Date("2026-09-19T10:00:00Z"))).toBe("2026-09-19");
  });

  it("ceilMonthsBetween counts calendar months and rounds partial months up", () => {
    expect(ceilMonthsBetween("2026-09-19", "2027-01-19")).toBe(4);
    expect(ceilMonthsBetween("2026-09-19", "2027-01-20")).toBe(5);
    expect(ceilMonthsBetween("2026-09-19", "2026-10-01")).toBe(1);
    expect(ceilMonthsBetween("2026-01-31", "2026-02-28")).toBe(1);
    expect(ceilMonthsBetween("2026-09-19", "2026-09-19")).toBe(0);
    expect(ceilMonthsBetween("2026-09-19", "2026-08-01")).toBe(0);
  });

  describe("resolveDateHint (relative dates resolve against the supplied today)", () => {
    const today = "2026-09-19"; // Saturday
    it("handles today / yesterday / day before yesterday", () => {
      expect(resolveDateHint({ kind: "today" }, today)).toBe("2026-09-19");
      expect(resolveDateHint({ kind: "none" }, today)).toBe("2026-09-19");
      expect(resolveDateHint({ kind: "yesterday" }, today)).toBe("2026-09-18");
      expect(resolveDateHint({ kind: "day_before_yesterday" }, today)).toBe("2026-09-17");
    });
    it("last Friday is the most recent Friday strictly before today", () => {
      expect(resolveDateHint({ kind: "last_weekday", weekday: "friday" }, today)).toBe("2026-09-18");
      expect(resolveDateHint({ kind: "last_weekday", weekday: "saturday" }, today)).toBe("2026-09-12");
      expect(resolveDateHint({ kind: "last_weekday", weekday: "sunday" }, today)).toBe("2026-09-13");
    });
    it("days_ago and explicit", () => {
      expect(resolveDateHint({ kind: "days_ago", n: 3 }, today)).toBe("2026-09-16");
      expect(resolveDateHint({ kind: "days_ago", n: -1 }, today)).toBeNull();
      expect(resolveDateHint({ kind: "explicit", date: "2026-08-15" }, today)).toBe("2026-08-15");
      expect(resolveDateHint({ kind: "explicit", date: "nonsense" }, today)).toBeNull();
    });
    it("crosses month boundaries", () => {
      expect(resolveDateHint({ kind: "yesterday" }, "2026-03-01")).toBe("2026-02-28");
    });
  });
});

describe("money", () => {
  it("round2 and sumMoney avoid float drift", () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(sumMoney([0.1, 0.2])).toBe(0.3);
    expect(round2(1234.567891)).toBe(1234.57);
    expect(round2(1.005)).toBe(1.01);
  });
  it("formats INR with Indian grouping", () => {
    expect(formatINR(452300)).toBe("₹4,52,300");
    expect(formatINR(1234.4)).toBe("₹1,234");
  });
});

describe("categories", () => {
  it("validates against the fixed list", () => {
    expect(isCategory("Food & Dining")).toBe(true);
    expect(isCategory("food & dining")).toBe(false);
    expect(isCategory("Crypto")).toBe(false);
  });
  it("late night = 23:00 to before 04:00", () => {
    expect(isLateNight("23:00")).toBe(true);
    expect(isLateNight("22:59")).toBe(false);
    expect(isLateNight("00:30:00")).toBe(true);
    expect(isLateNight("03:59")).toBe(true);
    expect(isLateNight("04:00")).toBe(false);
    expect(isLateNight(null)).toBe(false);
  });
});

describe("calculateSavingsBaseline", () => {
  const trend = [
    { month: "2026-06", total: 0, count: 0 },
    { month: "2026-07", total: 30_000, count: 20 },
    { month: "2026-08", total: 36_000, count: 25 },
    { month: "2026-09", total: 5_000, count: 3 },
  ];
  it("averages income - spend over prior months that have data (skips empty months and the partial current month)", () => {
    const b = calculateSavingsBaseline(trend, 45_000, "2026-09");
    expect(b.monthsUsed).toEqual(["2026-07", "2026-08"]);
    expect(b.avgMonthlySavings).toBe(12_000); // (15000 + 9000) / 2
    expect(b.savingsRate).toBeCloseTo(12_000 / 45_000);
  });
  it("floors at zero when the user overspends", () => {
    const b = calculateSavingsBaseline([{ month: "2026-08", total: 60_000, count: 5 }], 45_000, "2026-09");
    expect(b.avgMonthlySavings).toBe(0);
    expect(b.savingsRate).toBe(0);
    expect(b.hasData).toBe(true);
  });
  it("falls back to current month-to-date when there is no history", () => {
    const b = calculateSavingsBaseline([{ month: "2026-09", total: 10_000, count: 2 }], 45_000, "2026-09");
    expect(b.monthsUsed).toEqual(["2026-09"]);
    expect(b.avgMonthlySavings).toBe(35_000);
  });
  it("no data or no income => zero, hasData reflects reality", () => {
    expect(calculateSavingsBaseline([], 45_000, "2026-09")).toMatchObject({ avgMonthlySavings: 0, hasData: false });
    expect(calculateSavingsBaseline(trend, 0, "2026-09")).toMatchObject({ avgMonthlySavings: 0, savingsRate: 0 });
  });
});

const ex = (amount: number, category: string, merchant: string | null, spent_on: string, spent_at: string | null = null): ExpenseLike => ({
  amount, category, merchant, spent_on, spent_at,
});

describe("aggregateSpend", () => {
  const rows = [
    ex(450, "Food & Dining", "Zomato", "2026-09-10", "23:30"),
    ex(500, "Food & Dining", "zomato ", "2026-09-11", "13:00"),
    ex(1000, "Groceries", "BigBasket", "2026-09-05"),
    ex(300, "Transport", "", "2026-09-06"),
    ex(200, "Transport", null, "2026-09-07"),
    ex(999, "Shopping", "Amazon", "2026-08-15", "23:59"),
  ];
  const a = aggregateSpend(rows, "2026-09");

  it("totals, categories and zero-filled 6-month trend", () => {
    expect(a.total).toBe(2450);
    expect(a.count).toBe(5);
    expect(a.byCategory[0]).toEqual({ category: "Groceries", total: 1000 });
    expect(a.trend).toHaveLength(6);
    expect(a.trend[5]).toEqual({ month: "2026-09", total: 2450, count: 5 });
    expect(a.trend[4]).toEqual({ month: "2026-08", total: 999, count: 1 });
    expect(a.trend[0]).toEqual({ month: "2026-04", total: 0, count: 0 });
  });
  it("groups merchants case-insensitively and ignores empty merchants", () => {
    expect(a.topMerchants.find((m) => m.merchant.toLowerCase().trim() === "zomato")).toMatchObject({ total: 950, count: 2 });
    expect(a.topMerchants.map((m) => m.merchant.toLowerCase())).not.toContain("");
    expect(a.topMerchants).toHaveLength(2);
  });
  it("late-night discretionary excludes daytime and non-discretionary", () => {
    expect(a.lateNightDiscretionary).toBe(450);
    expect(a.discretionaryTotal).toBe(950);
  });
  it("empty user yields a stable shape", () => {
    const e = aggregateSpend([], "2026-09");
    expect(e).toMatchObject({ total: 0, count: 0, byCategory: [], topMerchants: [], discretionaryTotal: 0 });
    expect(e.trend).toHaveLength(6);
  });
  it("category averages divide by months that have data", () => {
    const avg = calculateCategoryAverages(
      [ex(300, "Food & Dining", "a", "2026-07-01"), ex(600, "Food & Dining", "a", "2026-08-01"), ex(900, "Food & Dining", "a", "2026-09-01")],
      "2026-09",
    );
    expect(avg).toEqual([{ category: "Food & Dining", avg: 450 }]); // current month excluded; 2 months of data
  });
});

describe("calculateWhatIf", () => {
  const goals = [{ id: "g1", title: "Laptop", remaining: 24_000, deadline: "2027-03-19" }];
  const input = { monthlyCost: 2_500, months: 12, income: 45_000, avgMonthlySavings: 9_000, goals, today: "2026-09-19" };

  it("computes budget impact deterministically", () => {
    const { budgetImpact: b } = calculateWhatIf(input);
    expect(b).toMatchObject({ totalCost: 30_000, savingsBefore: 9_000, savingsAfter: 6_500, shortfall: 0 });
    expect(b.incomeShare).toBeCloseTo(0.06, 2);
    expect(b.savingsRateBefore).toBeCloseTo(0.2, 2);
    expect(b.savingsRateAfter).toBeCloseTo(0.14, 2);
  });

  it("delays goals: 24000 at 9000/mo = 2.67 months vs 6500/mo = 3.69 months", () => {
    const { goalDelays } = calculateWhatIf(input);
    expect(goalDelays).toHaveLength(1);
    expect(goalDelays[0]!.monthsBefore).toBeCloseTo(2.67, 2);
    expect(goalDelays[0]!.monthsAfter).toBeCloseTo(3.69, 2);
    expect(goalDelays[0]!.delayMonths).toBeCloseTo(1.03, 1);
    expect(goalDelays[0]!.missesDeadline).toBe(false);
  });

  it("flags when the new cost makes a goal miss its deadline", () => {
    const { goalDelays } = calculateWhatIf({ ...input, avgMonthlySavings: 3_000, goals: [{ id: "g", title: "Bike", remaining: 12_000, deadline: "2027-03-19" }] });
    expect(goalDelays[0]!.missedDeadlineBefore).toBe(false);
    expect(goalDelays[0]!.missesDeadline).toBe(true);
  });

  it("savings wiped out: negative savingsAfter, shortfall reported, delay after EMI ends", () => {
    const r = calculateWhatIf({ ...input, avgMonthlySavings: 1_000 });
    expect(r.budgetImpact.savingsAfter).toBe(-1_500);
    expect(r.budgetImpact.shortfall).toBe(1_500);
    expect(r.budgetImpact.savingsRateAfter).toBe(0);
    expect(r.goalDelays[0]!.monthsAfter).toBeCloseTo(12 + 24_000 / 1_000, 2);
  });

  it("zero savings: goal unreachable, nulls instead of Infinity", () => {
    const r = calculateWhatIf({ ...input, avgMonthlySavings: 0 });
    expect(r.goalDelays[0]).toMatchObject({ monthsBefore: null, monthsAfter: null, delayMonths: null, missesDeadline: true });
  });

  it("skips completed goals and validates input", () => {
    expect(calculateWhatIf({ ...input, goals: [{ id: "x", title: "Done", remaining: 0, deadline: "2027-01-01" }] }).goalDelays).toEqual([]);
    expect(() => calculateWhatIf({ ...input, monthlyCost: 0 })).toThrow();
    expect(() => calculateWhatIf({ ...input, months: 0 })).toThrow();
    expect(() => calculateWhatIf({ ...input, months: 1.5 })).toThrow();
  });

  it("monthsToReach edge cases", () => {
    expect(monthsToReach(0, 0, 3, 0)).toBe(0);
    expect(monthsToReach(1000, 500, 3, 100)).toBe(2);
    expect(monthsToReach(2000, 500, 2, 0)).toBeNull();
  });
});
