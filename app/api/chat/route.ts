import { streamChatReply } from "@/lib/ai/chat";
import { AI_LIMITS } from "@/lib/ai/config";
import { apiRoute, readJson } from "@/lib/api/handler";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { chatBody } from "@/lib/api/schemas";
import { todayISO } from "@/lib/finance/dates";
import { buildFinancialFactSheet } from "@/lib/server/fact-sheet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HISTORY_PAGE = 50;

/** Additive convenience (not in the PRD table): the caller's chat history, oldest first. */
export const GET = apiRoute(async ({ store }) => {
  const rows = await store.listChat(HISTORY_PAGE);
  return { messages: rows.map((m) => ({ id: m.id, role: m.role, content: m.content, created_at: m.created_at })) };
});

/**
 * Streams the advisor reply as plain text. The model only sees the server-computed fact sheet, the
 * last 10 turns and the new message (as a user-role message). It has no tools and cannot write to the DB.
 * Both turns are persisted for the authenticated user only.
 */
export const POST = apiRoute(async ({ req, store, userId }) => {
  const { message } = await readJson(req, chatBody);
  enforceRateLimit(userId, "ai");

  const [facts, history] = await Promise.all([
    buildFinancialFactSheet(store, todayISO()),
    store.listChat(AI_LIMITS.chatHistoryTurns),
  ]);

  const iterator = streamChatReply({ persona: facts.persona, facts, history, message })[Symbol.asyncIterator]();
  // Pull the first chunk before answering so provider failures surface as a proper JSON error status.
  const first = await iterator.next();

  await store.insertChat("user", message);

  let reply = "";
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        let step = first;
        while (!step.done) {
          reply += step.value;
          controller.enqueue(encoder.encode(step.value));
          step = await iterator.next();
        }
        controller.close();
      } catch (err) {
        console.error(`[chat] stream interrupted: ${(err as Error).name}`);
        controller.error(err);
      } finally {
        if (reply.trim()) await store.insertChat("assistant", reply).catch(() => console.error("[chat] failed to persist reply"));
      }
    },
    async cancel() {
      await iterator.return?.();
    },
  });

  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
  });
});
