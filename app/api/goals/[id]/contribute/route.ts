import { apiRoute, readJson } from "@/lib/api/handler";
import { contributeBody, uuid } from "@/lib/api/schemas";
import { notFound } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = apiRoute(async ({ req, params, store }) => {
  const id = uuid.safeParse(params.id);
  if (!id.success) throw notFound("Goal not found");
  const { amount } = await readJson(req, contributeBody);
  const goal = await store.contributeToGoal(id.data, amount);
  if (!goal) throw notFound("Goal not found");
  return { goal };
});
