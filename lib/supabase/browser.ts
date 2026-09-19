import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser Supabase client for the frontend team (sign-in / sign-up / session).
 * Uses ONLY the public anon key; sessions are stored in cookies so /api route handlers can
 * authenticate the same user. Data access from the browser is still protected by RLS, but the
 * app should go through /api.
 */
export function createSupabaseBrowserClient() {
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
}
