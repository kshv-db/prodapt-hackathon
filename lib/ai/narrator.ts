import { AppError } from "@/lib/errors";
import { getAiClient } from "./client";
import { AI_LIMITS, getModel, type ModelTier } from "./config";
import { collectFigures, countWords, findUngroundedFigures } from "./grounding";
import { buildSystemPrompt, factsBlock } from "./prompts";
import type { PersonaId } from "@/lib/finance/categories";
import { ttlCache } from "./cache";

export interface NarrateOptions {
  task: string;
  tier: ModelTier;
  persona: PersonaId;
  instructions: string;
  /** Server-computed numbers/facts. The ONLY source of figures the model may use. */
  facts: Record<string, unknown>;
  /** Deterministic, grounded text used when AI is unavailable or fails validation twice. */
  fallback: string;
  wordRange?: readonly [min: number, max: number];
  /** When set, successful AI results are cached (same facts => same text, no repeat AI call). */
  cacheKey?: string;
}

export interface Narration {
  text: string;
  source: "ai" | "fallback";
}

const cache = ttlCache<string>(10 * 60_000, 500);

function clean(text: string): string {
  return text.trim().replace(/^["“”']+|["“”']+$/g, "").trim();
}

/**
 * Grounded prose generation: the model explains supplied facts, code verifies that every figure it
 * wrote exists in those facts (and optional word limits), retries once, then falls back to a
 * deterministic sentence. AI outages never break the endpoint that calls this.
 */
export async function narrate(opts: NarrateOptions): Promise<Narration> {
  if (opts.cacheKey) {
    const hit = cache.get(opts.cacheKey);
    if (hit) return { text: hit, source: "ai" };
  }
  const figures = collectFigures(opts.facts);
  try {
    const client = getAiClient();
    for (let attempt = 0; attempt < 2; attempt++) {
      const raw = await client.complete({
        model: getModel(opts.tier),
        messages: [
          { role: "system", content: buildSystemPrompt({ task: opts.task, persona: opts.persona, extra: opts.instructions }) },
          { role: "user", content: factsBlock(opts.facts) },
        ],
        maxTokens: AI_LIMITS.maxTokens.text,
      });
      const text = clean(raw);
      const words = countWords(text);
      const inRange = !opts.wordRange || (words >= opts.wordRange[0] && words <= opts.wordRange[1]);
      const ungrounded = findUngroundedFigures(text, figures);
      if (text && inRange && ungrounded.length === 0) {
        if (opts.cacheKey) cache.set(opts.cacheKey, text);
        return { text, source: "ai" };
      }
      console.warn(`[ai] ${opts.task}: rejected output (words=${words}, ungrounded=${ungrounded.length}) attempt ${attempt + 1}`);
    }
  } catch (err) {
    if (!(err instanceof AppError)) console.error(`[ai] ${opts.task}: unexpected ${(err as Error).name}`);
  }
  return { text: opts.fallback, source: "fallback" };
}

export const clearNarrationCache = () => cache.clear();
