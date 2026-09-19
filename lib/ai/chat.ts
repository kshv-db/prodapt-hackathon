import type { PersonaId } from "@/lib/finance/categories";
import { getAiClient, type AiMessage } from "./client";
import { AI_LIMITS, getModel, TASK_TIER } from "./config";
import { buildSystemPrompt, factsBlock, LANGUAGE_RULE } from "./prompts";

const CHAT_TASK =
  "Answer the user's money question as their personal finance advisor, using the FACTS message. " +
  "Be concise (under 120 words unless asked for detail). Refer to the user's real numbers. " +
  "When a question needs a figure that is not in FACTS (for example the price of a bike), ask for it instead of guessing. " +
  "You give general guidance, not regulated financial advice.";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  persona: PersonaId;
  facts: Record<string, unknown>;
  history: readonly ChatTurn[];
  message: string;
}

/**
 * Message layout keeps untrusted text out of instructions:
 *   system: rules + persona (static text only)
 *   system: FACTS (server-computed, user strings sanitised + JSON-escaped)
 *   history: prior turns in their original roles (last 10)
 *   user:    the new message
 */
export function buildChatMessages({ persona, facts, history, message }: ChatRequest): AiMessage[] {
  return [
    { role: "system", content: buildSystemPrompt({ task: CHAT_TASK, persona, extra: LANGUAGE_RULE }) },
    { role: "system", content: factsBlock(facts) },
    ...history.slice(-AI_LIMITS.chatHistoryTurns).map((t): AiMessage => ({ role: t.role, content: t.content })),
    { role: "user", content: message },
  ];
}

/** Streams the assistant reply as text chunks. Throws AppError (429/502/503) before the first chunk on failure. */
export function streamChatReply(req: ChatRequest): AsyncIterable<string> {
  return getAiClient().stream({
    model: getModel(TASK_TIER.chat),
    messages: buildChatMessages(req),
    maxTokens: AI_LIMITS.maxTokens.chat,
  });
}
