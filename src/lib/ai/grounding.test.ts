import { describe, expect, it } from "vitest";
import { findUngroundedNumbers } from "./grounding";

const facts = {
  spent: 4920,
  limit: 6000,
  usedPct: 82.4,
  saved: 138432,
  note: "Zomato 9 orders, 2 late-night",
  label: "₹1,450 this week",
};

describe("findUngroundedNumbers", () => {
  it("accepts figures that are in the facts, in any common format", () => {
    expect(findUngroundedNumbers("You spent ₹4,920 of ₹6,000.", facts)).toEqual([]);
    expect(findUngroundedNumbers("Food is at 82% of its limit.", facts)).toEqual([]);
    expect(findUngroundedNumbers("That is about ₹1.4 L saved.", facts)).toEqual([]);
    expect(findUngroundedNumbers("Roughly ₹6k limit.", facts)).toEqual([]);
    expect(findUngroundedNumbers("You had ₹1,450 last week.", facts)).toEqual([]);
  });

  it("flags figures the model invented", () => {
    expect(findUngroundedNumbers("You will save ₹9,999 more.", facts)).toEqual(["₹9,999"]);
    expect(findUngroundedNumbers("Food is at 95% of its limit.", facts)).toEqual(["95%"]);
    expect(findUngroundedNumbers("You could put away ₹5 lakh.", facts)).toEqual(["₹5 lakh"]);
  });

  it("ignores small counts and year-like numbers", () => {
    expect(findUngroundedNumbers("Try just 3 orders a week, by 2027.", facts)).toEqual([]);
  });

  it("still flags a small amount that carries a rupee sign", () => {
    expect(findUngroundedNumbers("Save ₹7 today.", facts)).toEqual(["₹7"]);
  });

  it("allows several sources, such as facts plus tool results", () => {
    expect(findUngroundedNumbers("₹4,920 and ₹777", facts, { extra: 777 })).toEqual([]);
  });
});
