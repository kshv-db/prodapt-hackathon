import { apiRoute, readJson } from "@/lib/api/handler";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { generateBudgetBody } from "@/lib/api/schemas";
import { todayISO } from "@/lib/finance/dates";
import { generateBudgetFor } from "@/lib/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Computes (does not save) a budget. The client edits it and saves via PUT /api/budgets. */
export const POST = apiRoute(async ({ req, store, userId }) => {
  const body = await readJson(req, generateBudgetBody);
  enforceRateLimit(userId, "ai");
  return generateBudgetFor(store, body, todayISO());
});
