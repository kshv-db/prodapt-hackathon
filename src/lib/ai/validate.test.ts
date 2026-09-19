import { describe, expect, it } from "vitest";
import { checkExpenseDate, checkNarrative, wordCount } from "./validate";
import { mockNarrative } from "./mock";
import { PROJECTION } from "./fixtures";

describe("checkExpenseDate", () => {
  const today = "2026-09-19";
  it("accepts today and recent dates", () => {
    expect(checkExpenseDate("2026-09-19", today)).toBeNull();
    expect(checkExpenseDate("2026-09-11", today)).toBeNull();
  });
  it("rejects future dates", () => {
    expect(checkExpenseDate("2026-09-20", today)).toMatch(/future/);
  });
  it("rejects dates over a year old", () => {
    expect(checkExpenseDate("2025-08-01", today)).toMatch(/year/);
  });
  it("rejects impossible calendar dates", () => {
    expect(checkExpenseDate("2026-02-31", today)).toMatch(/valid/);
    expect(checkExpenseDate("yesterday", today)).toMatch(/valid/);
  });
});

describe("checkNarrative", () => {
  it("requires 60 to 90 words", () => {
    expect(checkNarrative("too short")).not.toEqual([]);
    expect(checkNarrative(Array(75).fill("word").join(" "))).toEqual([]);
    expect(checkNarrative(Array(120).fill("word").join(" "))).not.toEqual([]);
  });
  it("the deterministic fallback narrative satisfies the rule", () => {
    const text = mockNarrative("friendly", PROJECTION);
    expect(wordCount(text)).toBeGreaterThanOrEqual(60);
    expect(wordCount(text)).toBeLessThanOrEqual(90);
    expect(checkNarrative(text)).toEqual([]);
  });
});
