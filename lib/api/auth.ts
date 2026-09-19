import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { AppError, unauthorized } from "@/lib/errors";
import { SupabaseStore } from "@/lib/server/supabase-store";
import type { Store } from "@/lib/server/store";

export interface RequestContext {
  userId: string;
  store: Store;
}

function config() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    console.error("[auth] NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are not set");
    throw new AppError(500, "Server is not configured");
  }
  return { url, anonKey };
}

async function clientForRequest(req: Request): Promise<{ client: SupabaseClient; token?: string }> {
  const { url, anonKey } = config();
  const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") ?? "")?.[1];
  if (bearer) {
    // API clients / tests: user JWT in the Authorization header. Anon key + user JWT => RLS applies.
    const client = createClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${bearer}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    return { client, token: bearer };
  }
  // Browser: Supabase session cookies (set by @supabase/ssr on the frontend).
  const { cookies } = await import("next/headers");
  const cookieStore = await cookies();
  const client = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: () => {
        /* token refresh is handled client-side; route handlers stay read-only for cookies */
      },
    },
  });
  return { client };
}

/**
 * Authenticates the request against Supabase Auth (the JWT is verified by Supabase, not merely decoded)
 * and returns a store bound to that user. The user id ALWAYS comes from here, never from the request body.
 * Only the anon key is used, so Postgres RLS is enforced on every query. There is no service-role key.
 */
export async function resolveContext(req: Request): Promise<RequestContext> {
  const { client, token } = await clientForRequest(req);
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) throw unauthorized();
  return { userId: data.user.id, store: new SupabaseStore(client, data.user.id) };
}
