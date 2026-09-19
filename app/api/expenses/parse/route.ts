import { parseExpenseText } from "@/lib/ai/expense-parser";
import { apiRoute, readJson } from "@/lib/api/handler";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { parseExpenseBody } from "@/lib/api/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = apiRoute(async ({ req, userId }) => {
  const { text, today } = await readJson(req, parseExpenseBody);
  enforceRateLimit(userId, "ai");
  // Relative dates ("kal", "last Friday") resolve against the caller-supplied `today`, never the server clock.
  return parseExpenseText(text, today);
});
