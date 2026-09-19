import { describe, expect, it } from "vitest";
import { calculateProjection, finalBalance } from "@/lib/finance/projection";

describe("calculateProjection", () => {
  it("zero savings stays at zero", () => {
    const s = calculateProjection({ monthlySaving: 0, years: 5 });
    expect(s).toHaveLength(61);
    expect(finalBalance(s)).toBe(0);
    expect(s.every((p) => p.balance === 0)).toBe(true);
  });

  it("matches the PRD recurrence balance[m] = balance[m-1]*(1+r/12)+saving with r=0.07", () => {
    const s = calculateProjection({ monthlySaving: 5000, years: 5 });
    expect(s[0]).toEqual({ month: 0, balance: 0 });
    expect(s[1]!.balance).toBe(5000);
    expect(s[2]!.balance).toBe(round2(5000 * (1 + 0.07 / 12) + 5000));
    // closed form of an ordinary annuity: S * ((1+i)^n - 1) / i
    const i = 0.07 / 12;
    const expected = 5000 * ((Math.pow(1 + i, 60) - 1) / i);
    expect(finalBalance(s)).toBeCloseTo(expected, 2);
  });

  it("5-year projection with 5,000/month is about 3.58 lakh", () => {
    expect(finalBalance(calculateProjection({ monthlySaving: 5000, years: 5 }))).toBeGreaterThan(357_000);
    expect(finalBalance(calculateProjection({ monthlySaving: 5000, years: 5 }))).toBeLessThan(359_000);
  });

  it("higher slider value always gives a higher balance", () => {
    const at = (v: number) => finalBalance(calculateProjection({ monthlySaving: v, years: 5 }));
    expect(at(0) < at(1000)).toBe(true);
    expect(at(1000) < at(5000)).toBe(true);
    expect(at(5000) < at(20000)).toBe(true);
  });

  it("is monotonically non-decreasing over time", () => {
    const s = calculateProjection({ monthlySaving: 2500, years: 3 });
    for (let i = 1; i < s.length; i++) expect(s[i]!.balance).toBeGreaterThan(s[i - 1]!.balance);
  });

  it("does not round step by step (rounding only on exposure)", () => {
    const s = calculateProjection({ monthlySaving: 3333.33, years: 5 });
    const i = 0.07 / 12;
    expect(finalBalance(s)).toBeCloseTo(3333.33 * ((Math.pow(1 + i, 60) - 1) / i), 2);
    for (const p of s) expect(Math.abs(p.balance * 100 - Math.round(p.balance * 100))).toBeLessThan(1e-6);
  });

  it("supports a custom return rate and starting balance", () => {
    const s = calculateProjection({ monthlySaving: 0, years: 1, annualReturn: 0.12, startingBalance: 1000 });
    expect(finalBalance(s)).toBeCloseTo(1000 * Math.pow(1.01, 12), 2);
  });

  it("rejects invalid input", () => {
    expect(() => calculateProjection({ monthlySaving: -1, years: 5 })).toThrow();
    expect(() => calculateProjection({ monthlySaving: 100, years: 0 })).toThrow();
    expect(() => calculateProjection({ monthlySaving: 100, years: 2.5 })).toThrow();
    expect(() => calculateProjection({ monthlySaving: Number.NaN, years: 5 })).toThrow();
  });
});

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
