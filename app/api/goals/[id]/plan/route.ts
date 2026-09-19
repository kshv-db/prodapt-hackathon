import { apiRoute } from "@/lib/api/handler";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { uuid } from "@/lib/api/schemas";
import { todayISO } from "@/lib/finance/dates";
import { notFound } from "@/lib/errors";
import { planForGoal } from "@/lib/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = apiRoute(async ({ params, store, userId }) => {
  const id = uuid.safeParse(params.id);
  if (!id.success) throw notFound("Goal not found");
  enforceRateLimit(userId, "ai");
  return planForGoal(store, id.data, todayISO());
});
