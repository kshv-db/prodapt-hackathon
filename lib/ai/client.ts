import OpenAI from "openai";
import { AppError } from "@/lib/errors";
import { AI_LIMITS } from "./config";

export interface AiMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CompleteRequest {
  model: string;
  messages: AiMessage[];
  /** When set, the model is constrained to this JSON schema (structured outputs). */
  json?: { name: string; schema: Record<string, unknown> };
  maxTokens?: number;
}

export interface AiClient {
  complete(req: CompleteRequest): Promise<string>;
  stream(req: Omit<CompleteRequest, "json">): AsyncIterable<string>;
}

/** Maps SDK failures to safe, user-facing errors. Provider details are logged, never returned. */
export function mapAiError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  const status = (err as { status?: number } | null)?.status;
  console.error(`[ai] provider error status=${status ?? "n/a"} ${(err as Error)?.name ?? ""}`);
  if (status === 429) return new AppError(429, "The AI service is busy. Please try again in a moment.");
  if (status === 401 || status === 403) return new AppError(503, "AI service is not configured");
  return new AppError(502, "The AI service is temporarily unavailable");
}

class OpenAiClient implements AiClient {
  private readonly openai: OpenAI;

  constructor(apiKey: string) {
    this.openai = new OpenAI({ apiKey, timeout: AI_LIMITS.requestTimeoutMs, maxRetries: 1 });
  }

  async complete({ model, messages, json, maxTokens }: CompleteRequest): Promise<string> {
    try {
      const res = await this.openai.chat.completions.create({
        model,
        messages,
        max_completion_tokens: maxTokens,
        ...(json
          ? { response_format: { type: "json_schema" as const, json_schema: { name: json.name, strict: true, schema: json.schema } } }
          : {}),
      });
      return res.choices[0]?.message?.content ?? "";
    } catch (err) {
      throw mapAiError(err);
    }
  }

  async *stream({ model, messages, maxTokens }: Omit<CompleteRequest, "json">): AsyncIterable<string> {
    try {
      const res = await this.openai.chat.completions.create({
        model,
        messages,
        max_completion_tokens: maxTokens,
        stream: true,
      });
      for await (const chunk of res) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) yield delta;
      }
    } catch (err) {
      throw mapAiError(err);
    }
  }
}

let override: AiClient | null = null;
let cached: AiClient | null = null;

/** Test seam: inject a fake client (pass null to reset). */
export const setAiClientForTests = (client: AiClient | null) => {
  override = client;
};

export function getAiClient(): AiClient {
  if (override) return override;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("[ai] OPENAI_API_KEY is not set");
    throw new AppError(503, "AI service is not configured");
  }
  cached ??= new OpenAiClient(apiKey);
  return cached;
}
