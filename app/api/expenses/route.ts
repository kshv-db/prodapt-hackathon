import { apiRoute, json, readJson, readQuery } from "@/lib/api/handler";
import { createExpenseBody, monthQuery } from "@/lib/api/schemas";
import { monthOf, todayISO } from "@/lib/finance/dates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = apiRoute(async ({ url, store }) => {
  const { month } = readQuery(url, monthQuery);
  const expenses = await store.listExpenses(month ?? monthOf(todayISO()));
  return { expenses };
});

export const POST = apiRoute(async ({ req, store }) => {
  const body = await readJson(req, createExpenseBody);
  // user_id is never read from the body: the store is bound to the authenticated user.
  const expense = await store.insertExpense({
    amount: body.amount,
    category: body.category,
    merchant: body.merchant,
    note: body.note ?? null,
    spent_on: body.spent_on,
    spent_at: body.spent_at ?? null,
    source: body.source,
  });
  return json({ expense }, 201);
});
