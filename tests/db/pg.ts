import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const ROOT = path.resolve(import.meta.dirname, "../..");
const MIGRATIONS_DIR = path.join(ROOT, "supabase/migrations");
const CANONICAL_REF = "origin/feature/db";

export const USER_A = "11111111-1111-1111-1111-111111111111";
export const USER_B = "22222222-2222-2222-2222-222222222222";

export interface Migration {
  name: string;
  sql: string;
}

/**
 * All migrations in filename order. The canonical schema (20260919000001..4) is owned by feature/db and is NOT
 * copied into this branch: until feature/db is merged we read those files straight from the fetched
 * `origin/feature/db` git objects; after the merge they are simply in supabase/migrations.
 * Backend-owned migrations (>= 20260919000005) always come from the working tree.
 */
export function loadMigrations(): Migration[] {
  const files = new Map<string, string>();
  for (const f of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"))) {
    files.set(f, readFileSync(path.join(MIGRATIONS_DIR, f), "utf8"));
  }
  if (![...files.keys()].some((f) => f.includes("initial_schema"))) {
    const opts = { cwd: ROOT, encoding: "utf8" as const, env: { ...process.env, MSYS_NO_PATHCONV: "1" } };
    const listing = execFileSync("git", ["ls-tree", "--name-only", CANONICAL_REF, "supabase/migrations/"], opts);
    for (const file of listing.split("\n").map((l) => l.trim()).filter((f) => f.endsWith(".sql"))) {
      files.set(path.basename(file), execFileSync("git", ["show", `${CANONICAL_REF}:${file}`], opts));
    }
  }
  return [...files.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, sql]) => ({ name, sql }));
}

/** Real Postgres (PGlite) with ALL migrations applied and a Supabase-like auth/roles stub. */
export async function createDb(): Promise<PGlite> {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    grant usage on schema public to anon, authenticated;
    -- Supabase grants privileges on public objects to these roles by default; RLS does the gating.
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on sequences to anon, authenticated;
    alter default privileges in schema public grant execute on functions to anon, authenticated;
    insert into auth.users (id) values ('${USER_A}'), ('${USER_B}');
  `);
  for (const m of loadMigrations()) await db.exec(m.sql);
  return db;
}

/** Run `fn` as an authenticated Supabase user (RLS applies), or as anon when userId is null. */
export async function asUser<T>(db: PGlite, userId: string | null, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role ${userId ? "authenticated" : "anon"}`);
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId ?? ""]);
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
  }
}
