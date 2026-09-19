import { apiRoute } from "@/lib/api/handler";
import { uuid } from "@/lib/api/schemas";
import { notFound } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const DELETE = apiRoute(async ({ params, store }) => {
  const parsed = uuid.safeParse(params.id);
  if (!parsed.success) throw notFound("Expense not found");
  // RLS hides other users' rows, so "not yours" and "does not exist" are deliberately indistinguishable (404).
  const deleted = await store.deleteExpense(parsed.data);
  if (!deleted) throw notFound("Expense not found");
  return { ok: true };
});
