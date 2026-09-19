import { apiRoute } from "@/lib/api/handler";
import { todayISO } from "@/lib/finance/dates";
import { seedDemo } from "@/lib/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Idempotent: a second call for the same user inserts nothing and still returns { ok: true }. */
export const POST = apiRoute(async ({ store }) => {
  await seedDemo(store, todayISO());
  return { ok: true };
});
