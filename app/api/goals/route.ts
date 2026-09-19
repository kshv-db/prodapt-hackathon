import { apiRoute, json, readJson } from "@/lib/api/handler";
import { createGoalBody } from "@/lib/api/schemas";
import { todayISO } from "@/lib/finance/dates";
import { badRequest } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = apiRoute(async ({ store }) => ({ goals: await store.listGoals() }));

export const POST = apiRoute(async ({ req, store }) => {
  const body = await readJson(req, createGoalBody);
  if (body.deadline < todayISO()) throw badRequest("deadline: must not be in the past");
  const goal = await store.insertGoal({ title: body.title, target_amount: body.target, deadline: body.deadline });
  return json({ goal }, 201);
});
