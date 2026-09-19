import { apiRoute, readJson } from "@/lib/api/handler";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { futureBody } from "@/lib/api/schemas";
import { todayISO } from "@/lib/finance/dates";
import { futureYou } from "@/lib/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read-only: no database writes. The client renders the live slider chart itself with the same
 * formula (lib/finance/projection) and calls this endpoint when the slider is released.
 */
export const POST = apiRoute(async ({ req, store, userId }) => {
  const body = await readJson(req, futureBody);
  enforceRateLimit(userId, "ai");
  return futureYou(store, body, todayISO());
});
