import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import type { ZodType } from "zod";
import { aiTimeoutMs } from "./config";

let client: OpenAI | null = null;

/** Server-side only. The key is read from OPENAI_API_KEY and never sent to the browser. */
export function openai(): OpenAI {
  if (!client) client = new OpenAI({ timeout: aiTimeoutMs(), maxRetries: 1 });
  return client;
}

export class AiError extends Error {}

type Message = { role: "system" | "user" | "assistant"; content: string };

/**
 * JSON-schema-mode call, validated against the zod schema. One retry on invalid
 * or unparseable output, then a safe error.
 */
export async function structured<T>(opts: {
  model: string;
  schema: ZodType<T>;
  name: string;
  messages: Message[];
}): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await openai().chat.completions.parse({
        model: opts.model,
        messages: opts.messages,
        response_format: zodResponseFormat(opts.schema as never, opts.name),
      });
      const parsed = res.choices[0]?.message.parsed;
      const checked = opts.schema.safeParse(parsed);
      if (checked.success) return checked.data;
      lastError = checked.error;
    } catch (err) {
      lastError = err;
    }
  }
  console.error(`[ai] ${opts.name} failed after retry`, lastError);
  throw new AiError("The AI response could not be used. Please try again.");
}

export async function text(opts: { model: string; messages: Message[] }): Promise<string> {
  try {
    const res = await openai().chat.completions.create({
      model: opts.model,
      messages: opts.messages,
    });
    const out = res.choices[0]?.message.content?.trim();
    if (!out) throw new Error("empty completion");
    return out;
  } catch (err) {
    console.error("[ai] text generation failed", err);
    throw new AiError("The AI response could not be generated. Please try again.");
  }
}

/** Streams plain text chunks as a web ReadableStream for route handlers. */
export function streamText(opts: { model: string; messages: Message[] }): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      try {
        const stream = await openai().chat.completions.create({
          model: opts.model,
          messages: opts.messages,
          stream: true,
        });
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta?.content;
          if (delta) controller.enqueue(encoder.encode(delta));
        }
      } catch (err) {
        console.error("[ai] chat stream failed", err);
        controller.enqueue(encoder.encode("\n\nSorry, I could not finish that answer. Please try again."));
      } finally {
        controller.close();
      }
    },
  });
}
