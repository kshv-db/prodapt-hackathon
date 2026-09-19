/**
 * Single place to swap OpenAI models. Model IDs come from the environment so no
 * ID is hardcoded here; pick current ones from the OpenAI dashboard.
 *
 *   fast: parse expense, categorize batch (small, low latency)
 *   mid:  budget, insight, Future You narrative, chat
 */
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}. See .env.example.`);
  return value;
}

export const aiModels = {
  get fast() {
    return required("OPENAI_MODEL_FAST");
  },
  get mid() {
    return required("OPENAI_MODEL_MID");
  },
};

export const CHAT_HISTORY_TURNS = 10;

/** AI_MOCK=1 returns deterministic canned responses, so the UI can be built without an OpenAI key. */
export function aiMock(): boolean {
  return process.env.AI_MOCK === "1";
}

/** Per-request timeout for OpenAI calls. */
export function aiTimeoutMs(): number {
  const n = Number(process.env.AI_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 15000;
}
