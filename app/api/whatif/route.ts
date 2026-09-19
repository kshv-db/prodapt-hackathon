import { apiRoute, readJson } from "@/lib/api/handler";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { whatIfBody } from "@/lib/api/schemas";
import { todayISO } from "@/lib/finance/dates";
import { whatIf } from "@/lib/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = apiRoute(async ({ req, store, userId }) => {
  const body = await readJson(req, whatIfBody);
  enforceRateLimit(userId, "ai");
  return whatIf(store, body, todayISO());
});
