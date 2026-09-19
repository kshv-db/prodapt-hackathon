import { z } from "zod";
import { AppError } from "@/lib/errors";
import { CATEGORIES } from "@/lib/finance/categories";
import type { BudgetLimit } from "@/lib/finance/budget";
import { AI_LIMITS, TASK_TIER } from "./config";
import { collectFigures, findUngroundedFigures } from "./grounding";
import { generateStructured } from "./structured";
import { buildSystemPrompt } from "./prompts";

const TASK = `Rewrite the one-line reason for each budget category so it reads naturally.
Each item in "lines" has a category, a computed limit and a factual draft reason. Keep every figure from the draft exactly; add none. One short sentence (max 20 words) per category. Return every category exactly once. You are NOT allowed to change or invent limits.`;

const JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reasons"],
  properties: {
    reasons: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["category", "reason"],
        properties: { category: { type: "string", enum: [...CATEGORIES] }, reason: { type: "string" } },
      },
    },
  },
} as const;

const schema = z.object({ reasons: z.array(z.object({ category: z.enum(CATEGORIES), reason: z.string().min(1).max(200) })) });

/**
 * Optional AI polish for budget reasons. Limits are NEVER taken from the model: only the text is,
 * and only if every category is present once and every figure in it exists in the computed lines.
 * Any failure returns the deterministic reasons untouched.
 */
export async function polishBudgetReasons(budgets: readonly BudgetLimit[], savings: { limit: number; reason: string }): Promise<BudgetLimit[]> {
  const lines = budgets.map((b) => ({ category: b.category, limit: b.limit, draft: b.reason }));
  const facts = { lines, savings: { limit: savings.limit } };
  const figures = collectFigures(facts);
  // Draft reasons embed formatted figures (e.g. "₹13,000"); ground against those too.
  for (const b of budgets) figures.push(...(b.reason.match(/\d[\d,]*/g) ?? []).map((n) => Number(n.replace(/,/g, ""))));
  try {
    const result = await generateStructured({
      tier: TASK_TIER.budgetReasons,
      system: buildSystemPrompt({ task: "Polish budget reasons.", extra: TASK }),
      user: JSON.stringify(facts),
      schemaName: "budget_reasons",
      jsonSchema: JSON_SCHEMA,
      validate: (raw) => {
        const value = schema.parse(raw);
        const seen = new Set(value.reasons.map((r) => r.category));
        if (seen.size !== CATEGORIES.length || value.reasons.length !== CATEGORIES.length) throw new Error("categories mismatch");
        if (value.reasons.some((r) => findUngroundedFigures(r.reason, figures).length > 0)) throw new Error("ungrounded figure");
        return value;
      },
      maxTokens: AI_LIMITS.maxTokens.budgetReasons,
    });
    const byCat = new Map(result.reasons.map((r) => [r.category, r.reason] as const));
    return budgets.map((b) => ({ ...b, reason: byCat.get(b.category) ?? b.reason }));
  } catch (err) {
    if (err instanceof AppError) return [...budgets]; // outage / rate limit / invalid output: keep deterministic reasons
    throw err;
  }
}
