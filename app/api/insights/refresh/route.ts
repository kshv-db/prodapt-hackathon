import { apiRoute } from "@/lib/api/handler";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { todayISO } from "@/lib/finance/dates";
import { refreshInsight } from "@/lib/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = apiRoute(async ({ store, userId }) => {
  enforceRateLimit(userId, "ai");
  return { insight: await refreshInsight(store, todayISO()) };
});
