import { describe, expect, it } from "vitest";
import { parseExpense } from "./tasks";
import { mockParseExpense } from "./mock";
import { caseCorrect, EVAL_SET, EVAL_TODAY } from "./evalSet";

/**
 * Two evals over the same 20 phrases:
 *  - the mock parser always runs (guards the heuristic used when AI_MOCK=1)
 *  - the real model runs only when OPENAI_API_KEY and OPENAI_MODEL_FAST are set and AI_MOCK is off.
 *    Target from the PRD: at least 18 of 20.
 */

describe("parser eval: mock heuristic", () => {
  it("gets at least 18 of 20 right", () => {
    const wrong = EVAL_SET.filter((c) => !caseCorrect(mockParseExpense(c.input, EVAL_TODAY), c));
    expect(wrong.map((c) => c.input)).toEqual([]);
  });
});

const live = Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL_FAST) && process.env.AI_MOCK !== "1";

describe.skipIf(!live)("parser eval: real model", () => {
  it("gets at least 18 of 20 right", { timeout: 120_000 }, async () => {
    const results = await Promise.all(
      EVAL_SET.map(async (c) => ({ c, got: await parseExpense(c.input, EVAL_TODAY) })),
    );
    const wrong = results.filter(({ c, got }) => !caseCorrect(got, c));
    console.log(`parser eval: ${EVAL_SET.length - wrong.length}/${EVAL_SET.length}`);
    for (const { c, got } of wrong) console.log("MISS:", c.input, "->", JSON.stringify(got));
    expect(EVAL_SET.length - wrong.length).toBeGreaterThanOrEqual(18);
  });
});
