import { apiRoute, readJson } from "@/lib/api/handler";
import { profileBody } from "@/lib/api/schemas";
import type { ProfileUpdate } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Additive convenience (not in the PRD table): read the caller's profile. `profile` is null before onboarding. */
export const GET = apiRoute(async ({ store }) => ({ profile: await store.getProfile() }));

/** Creates the profile on first call (onboarding) and updates it afterwards. All fields optional. */
export const PUT = apiRoute(async ({ req, store }) => {
  const body = await readJson(req, profileBody);
  const update: ProfileUpdate = {};
  if (body.name !== undefined) update.name = body.name;
  if (body.income !== undefined) update.monthly_income = body.income;
  if (body.fixedCosts !== undefined) update.fixed_costs = body.fixedCosts;
  if (body.persona !== undefined) update.persona = body.persona;
  return { profile: await store.upsertProfile(update) };
});
