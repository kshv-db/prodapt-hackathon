import { createBrowserClient } from "@supabase/ssr";

/** Browser Supabase client (anon key only). The session lives in cookies so /api routes see the same user. */
export const supabaseBrowser = () =>
  createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
