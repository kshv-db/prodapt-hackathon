import { apiRoute } from "@/lib/api/handler";
import { seedDemo } from "@/lib/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Delegates to the canonical seed_demo_data() RPC. Re-running replaces the previous seed rows (no duplicates). */
export const POST = apiRoute(async ({ store }) => {
  await seedDemo(store);
  return { ok: true };
});
