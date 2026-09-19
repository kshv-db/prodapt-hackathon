/** All model IDs and AI tunables live here so they can be swapped in one place (PRD section 6). */
export type ModelTier = "fast" | "mid";

const DEFAULT_MODELS: Record<ModelTier, string> = {
  fast: "gpt-4o-mini", // parse + categorize: small, fast
  mid: "gpt-4o", // budget reasons, insight, Future You, chat
};

const ENV_KEYS: Record<ModelTier, string> = { fast: "OPENAI_MODEL_FAST", mid: "OPENAI_MODEL_MID" };

export const getModel = (tier: ModelTier): string => process.env[ENV_KEYS[tier]]?.trim() || DEFAULT_MODELS[tier];

/** PRD section 6 task -> tier mapping. */
export const TASK_TIER = {
  parseExpense: "fast",
  categorize: "fast",
  budgetReasons: "mid",
  insight: "mid",
  futureNarrative: "mid",
  planSuggestion: "mid",
  whatIf: "mid",
  chat: "mid",
} as const satisfies Record<string, ModelTier>;

export const AI_LIMITS = {
  chatHistoryTurns: 10,
  categorizeBatchSize: 50,
  categorizeConcurrency: 3,
  requestTimeoutMs: 30_000,
  maxTokens: { parse: 300, categorize: 2500, budgetReasons: 1200, text: 400, chat: 700 },
} as const;
