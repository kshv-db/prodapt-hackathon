import { AppError } from "@/lib/errors";
import { getAiClient, type AiMessage } from "./client";
import { getModel, type ModelTier } from "./config";

/** The model kept returning output that failed validation (after one retry). */
export class AiInvalidOutputError extends AppError {
  constructor() {
    super(502, "The AI returned an unusable response. Please try again.");
    this.name = "AiInvalidOutputError";
  }
}

export interface StructuredRequest<T> {
  tier: ModelTier;
  system: string;
  user: string;
  schemaName: string;
  /** JSON schema (strict mode: all properties required, additionalProperties false). */
  jsonSchema: Record<string, unknown>;
  /** Must throw when the parsed value is invalid (zod `.parse` fits). */
  validate: (raw: unknown) => T;
  maxTokens: number;
}

/**
 * Schema-constrained generation with server-side validation: parse -> validate -> on failure retry ONCE ->
 * else AiInvalidOutputError. Transport errors (rate limit, outage) propagate immediately as AppError.
 */
export async function generateStructured<T>(req: StructuredRequest<T>): Promise<T> {
  const client = getAiClient();
  const messages: AiMessage[] = [
    { role: "system", content: req.system },
    { role: "user", content: req.user },
  ];
  for (let attempt = 0; attempt < 2; attempt++) {
    const text = await client.complete({
      model: getModel(req.tier),
      messages,
      json: { name: req.schemaName, schema: req.jsonSchema },
      maxTokens: req.maxTokens,
    });
    try {
      return req.validate(JSON.parse(text));
    } catch {
      console.warn(`[ai] ${req.schemaName}: invalid output on attempt ${attempt + 1}`);
    }
  }
  throw new AiInvalidOutputError();
}
