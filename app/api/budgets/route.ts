import { apiRoute, readJson, readQuery } from "@/lib/api/handler";
import { monthQuery, putBudgetsBody } from "@/lib/api/schemas";
import { monthOf, todayISO } from "@/lib/finance/dates";
import { budgetToApi, saveBudgets } from "@/lib/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = apiRoute(async ({ url, store }) => {
  const { month } = readQuery(url, monthQuery);
  const rows = await store.listBudgets(month ?? monthOf(todayISO()));
  return { budgets: rows.map(budgetToApi) };
});

/** Replaces the month's budget with the supplied list (month from ?month=, body.month, or the current month). */
export const PUT = apiRoute(async ({ req, url, store }) => {
  const { month: queryMonth } = readQuery(url, monthQuery);
  const body = await readJson(req, putBudgetsBody);
  const month = body.month ?? queryMonth ?? monthOf(todayISO());
  const budgets = await saveBudgets(
    store,
    month,
    body.budgets.map((b) => ({ category: b.category, limit: b.limit, reason: b.reason ?? null })),
  );
  return { budgets };
});
