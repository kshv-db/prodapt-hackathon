import { apiRoute, readQuery } from "@/lib/api/handler";
import { monthQuery } from "@/lib/api/schemas";
import { monthOf, todayISO } from "@/lib/finance/dates";
import { buildSummary } from "@/lib/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = apiRoute(async ({ url, store }) => {
  const { month } = readQuery(url, monthQuery);
  const today = todayISO();
  return buildSummary(store, month ?? monthOf(today), today);
});
