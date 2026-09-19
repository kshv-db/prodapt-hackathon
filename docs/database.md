# FutureWallet — Database & Supabase layer

Source of truth for product requirements: `FutureWallet-PRD.md` (§7 Data model, §10 Tech stack).
This document covers the DB/Supabase layer only — no frontend, AI, or finance-calculation logic lives here (that belongs to `/lib/ai` and `/lib/finance` per the PRD's ownership table).

## Architecture

```
Supabase Auth (auth.users)
        |
profiles (id = auth.users.id)
        |
expenses / budgets / goals / insights / chat_messages  (user_id -> auth.users.id)
        |
Row Level Security (user_id = auth.uid())
        |
Backend API routes (per PRD §8 contract)
        |
Frontend
```

## Migrations

Located in `supabase/migrations/`, applied in filename order:

| File | Purpose |
|---|---|
| `20260919000001_initial_schema.sql` | `expense_category` domain, all 6 tables, FKs, check constraints |
| `20260919000002_indexes.sql` | Indexes for the actual dashboard/chat/list query patterns |
| `20260919000003_rls.sql` | Enables RLS on every table + one policy set per table |
| `20260919000004_seed_support.sql` | `seed_demo_data()` function backing `POST /api/demo/seed` |

Apply with the Supabase CLI: `supabase start` (or link a remote project with `supabase link`), then `supabase db reset` (local) or `supabase db push` (remote). **Not yet run in this environment** — see "Verification status" below.

## Schema

### `profiles`
One row per authenticated user, `id` is a foreign key to `auth.users.id` (not an independent identity). Created by the backend after signup, once, for the signed-in user only — RLS's `with check (id = auth.uid())` on insert is what actually prevents a profile from being created for anyone else, whatever the app-layer trigger/route logic does.

- `fixed_costs jsonb` — array of `{ "label": string, "amount": number }`. This shape isn't specified verbatim in the PRD; it's the minimal structure that satisfies `POST /budget/generate`'s `fixedCosts[]` input. If the backend/AI team already committed to a different shape before this was written, treat that as authoritative and update the comment on the column, not the column type.
- `persona` constrained to `friendly | roast | coach` (PRD §7, §F7).
- `monthly_income` uses `numeric(12,2)`, never floating point (see "Monetary types" below).

### `expenses`
- `category` uses the shared `expense_category` domain (see "Category validation").
- `spent_on date` is the expense date; `spent_at time` is time-of-day only, nullable, used solely for the late-night (≥ 23:00) impulse-spend signal that feeds the health score. It is intentionally a `time`, not `timestamptz`, matching the PRD's literal column spec.
- `source` constrained to `manual | nl | csv | seed` — `seed` is what makes demo data safely distinguishable/removable from real entries.
- `amount > 0` — expenses are always positive; there's no PRD concept of a negative/refund expense row.

### `budgets`
- Unique on `(user_id, month, category)` — enforced in the schema, not just app logic.
- `month date`, always normalized to the 1st of the month (`budgets_month_is_first_of_month` check). The API's `?month=YYYY-MM` maps to this column with `to_char(month, 'YYYY-MM')` on read and `date_trunc('month', <input>::date)` on write — there is exactly one internal representation, so there's no risk of e.g. `2026-09-01` and `2026-09-15` being treated as different budget months.
- `limit_amount >= 0`.

### `goals`
- `target_amount > 0`, `saved_amount >= 0` — enforced at the database level so a broken client can't write a nonsensical goal.
- No progress/on-track computation lives here; that's `/lib/finance`'s job per PRD §9.

### `insights`
Append-only history of AI-generated insight text (`kind`, `body`). Nothing in the PRD asks for a "latest only" replace behavior, so old insights are retained rather than overwritten — if the product later wants "show only the latest," that's a `WHERE`/`ORDER BY ... LIMIT 1` on read, not a schema change.

### `chat_messages`
Append-only advisor chat turns, `role` constrained to `user | assistant`. System prompts are assembled server-side per request and are never written as rows — only the actual conversation turns are persisted, which is also what makes "last 10 turns" (`ORDER BY created_at DESC LIMIT 10`) a correct, cheap query.

## Category validation

Twelve fixed categories from PRD §7, enforced via a Postgres **domain** (`public.expense_category`) rather than a native `ENUM` or a per-table `CHECK (category IN (...))`:

- A domain is reusable across both `expenses.category` and `budgets.category` — one constraint to change later, not two.
- Native `ENUM` was rejected because adding a value (`ALTER TYPE ... ADD VALUE`) cannot run inside the same transaction as other DDL, which complicates future migrations for a value that hackathon iteration is likely to touch.
- Changing the list later: `ALTER DOMAIN public.expense_category DROP CONSTRAINT expense_category_check, ADD CONSTRAINT expense_category_check CHECK (VALUE IN (...))` in a new migration.

## Cascade / delete behavior

Every user-owned table's FK to `auth.users(id)` is `ON DELETE CASCADE`. If an auth user is deleted, their profile and all financial rows (expenses, budgets, goals, insights, chat_messages) are deleted with them — no orphaned financial data is left behind, and no separate cleanup job is needed. This is a deliberate privacy-first choice (deleting your account deletes your data); if FutureWallet later needs a "soft delete"/retention window, that's an explicit product decision to revisit, not an oversight here.

## Row Level Security

RLS is enabled on all six tables. No policy anywhere uses `USING (true)`; every policy resolves to `auth.uid()` against either `id` (profiles) or `user_id` (everything else). Full CRUD (select/insert/update/delete) is allowed on `expenses`, `budgets`, and `goals` since the API contract edits and removes rows in all three. `profiles` allows select/insert/update only (a profile is never user-deleted, only cascade-deleted with the auth user). `insights` and `chat_messages` allow select/insert only — both are append-only histories with no PRD-specified edit/delete path.

Service-role keys (server-only, e.g. for admin/maintenance tasks) bypass RLS entirely by Supabase design. Any backend code that uses the service role instead of the user's own session **must** filter by the intended `user_id` itself — RLS is the database-level baseline, not a substitute for correct backend code, but backend code should default to the user's own authenticated Supabase client wherever possible so RLS does the enforcement.

### Cross-user isolation — how to verify

No live Supabase project is linked in this environment (see "Verification status"), so this is a manual test plan for whoever runs these migrations against a real project:

1. Sign up user A and user B via Supabase Auth; create a profile for each.
2. As A, insert one row into each of `expenses`, `budgets`, `goals`, `insights`, `chat_messages`.
3. As B (a separate authenticated session/client, anon key + B's JWT — not service role): `select * from` each table and confirm **zero** rows belonging to A come back; attempt `update`/`delete` against A's known row ids and confirm 0 rows affected.
4. As an anonymous (unauthenticated) client: confirm every table returns zero rows and every write is rejected.
5. Confirm invalid writes are rejected by constraints, not just ignored: negative `amount`/`target_amount`, an out-of-list `category`, an invalid `persona`/`role`/`source`, and a duplicate `(user_id, month, category)` budget insert.

## Indexes

| Index | Serves |
|---|---|
| `expenses(user_id, spent_on desc)` | Monthly expense queries, date-ordered lists |
| `expenses(user_id, created_at desc)` | Recently-added expenses |
| `expenses(user_id, category)` | Dashboard category donut / per-category aggregation |
| `goals(user_id)` | Goals list per user |
| `chat_messages(user_id, created_at desc)` | Last-N-turns chat context |
| `insights(user_id, created_at desc)` | Insight history, most recent first |

`budgets(user_id, month, category)` is **not** duplicated as a separate index — the `budgets_user_month_category_unique` unique constraint already creates that exact btree index, and its leftmost-prefix columns (`user_id`, then `user_id, month`) already serve those narrower lookups. Adding a second identical index would only cost extra write overhead for no query benefit.

## Demo seed data

`public.seed_demo_data()` (SQL function, `SECURITY INVOKER`) is what `POST /api/demo/seed` should call via `supabase.rpc('seed_demo_data')` using the signed-in user's own client — not the service-role key. Because it's `SECURITY INVOKER`, every insert/delete it performs still goes through the RLS policies above; the function only *generates* the data, it does not bypass ownership checks.

What it creates, per call, for `auth.uid()`:
- **3 months** of everyday expenses (current month + previous two) across 10 of the 12 categories (Education and Travel are deliberately left out of the generic seed — they're occasional/persona-specific per the PRD's example users, not a universal monthly pattern, so forcing them in would look less realistic, not more).
- A **deliberate late-night pattern**: 3–4 additional `Food & Dining` rows per month with `spent_at` between 23:00–23:59, tagged `note = 'Late-night order'` — enough for the health score's impulse-control component (PRD §9) to have a real signal to act on.
- **One budget row per (seeded) category for the current month**, sized as a share of `profiles.monthly_income` (falling back to a ₹45,000 assumption if income is unset/zero).
- **Two goals**: "New Laptop" (₹55,000 target, 6-month deadline) and "Emergency Fund" (₹30,000 target, 12-month deadline), both with a partial `saved_amount` so goal-progress UI has something to show immediately.

It refuses to run for a user with no `profiles` row yet (raises an exception instead) — per PRD §13, this function never invents a profile.

### Idempotency ("Load Demo Data" clicked twice)

Only rows explicitly identifiable as seed data are touched, and only for the calling user:

- **expenses** — deleted where `source = 'seed'`, then reinserted. Manually entered (`source in ('manual','nl','csv')`) expenses are never touched.
- **budgets** — inserted with `ON CONFLICT (user_id, month, category) DO UPDATE`, so re-seeding the same month just refreshes the limit/reason in place; it can never create a duplicate row (the unique constraint would reject that regardless).
- **goals** — deleted by the two fixed demo titles ("New Laptop", "Emergency Fund") for that user, then reinserted. Trade-off, documented here rather than silently: if a real user happens to create a goal with exactly one of those titles, re-running the demo seed will replace it. Given this only fires on an explicit "Load Demo Data" action, that's an acceptable hackathon-scope trade-off; a production system would add an explicit `source` column to `goals` instead.

Seed data is always generated relative to `current_date`, so it never goes stale — every call produces a fresh 3-month window ending in the current month.

## Monetary types

All monetary columns (`monthly_income`, `amount`, `limit_amount`, `target_amount`, `saved_amount`) use `numeric(12,2)`, never `float`/`double precision`, so money can't pick up floating-point rounding error. Formatting (₹, thousands separators) is a frontend concern; the database only ever stores plain numeric values.

## Environment variables

Names only — see `.env.example`. No real values are committed anywhere in this repo.

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — safe for the browser; RLS is what keeps data isolated even with the anon key.
- `SUPABASE_SERVICE_ROLE_KEY` — server-only, bypasses RLS, must never reach client code.
- `OPENAI_API_KEY` — owned by the AI role, listed for completeness.

`.env` was previously tracked in git with no `.gitignore` entry; it has been untracked and `.gitignore` updated so it can never accidentally carry real secrets into a commit.

## Verification status

**Migrations are ready locally; they have not been applied to any Supabase project (local or remote), and there is no linked project in this environment.** This machine has no Supabase CLI, no Docker, and no local `psql`/Postgres, so the SQL could be reviewed carefully but not executed. Every statement was checked by hand against Postgres/PL-pgSQL syntax (domains, RLS policy syntax, `FOREACH ... SLICE`, `ON CONFLICT`, JSONB operators), but "ready locally" here means "written and reviewed," not "verified against a running database."

Before this is treated as done:
1. Install the Supabase CLI, `supabase init` (or use this existing `supabase/` folder as-is), `supabase start`.
2. `supabase db reset` to apply all four migrations to a clean local Postgres and confirm no errors.
3. Run the manual cross-user isolation and constraint tests in "Row Level Security" above.
4. `supabase link` to the team's real project and `supabase db push` when ready to go live — nothing has been pushed to any remote Supabase project by this work.
5. If/when a Next.js (or other) app in this repo adds `@supabase/supabase-js` and a `package.json`, run `supabase gen types typescript` against the linked project to generate real, non-hand-written types.

## Known architecture mismatch (flagging, not fixing)

The PRD (§10) specifies Next.js (App Router) route handlers under `/app/api` as the backend. The repository currently contains two parallel, entirely empty Python scaffolds instead (`/app/**/*.py` and `/backend/**/*.py`, FastAPI-shaped, `requirements.txt`, no `package.json`). This is outside the scope of the database work (this task explicitly excludes redesigning API contracts or implementing backend routes), but whoever owns "Backend and DB" per the PRD's ownership table should resolve which stack is actually being built before wiring `POST /api/demo/seed` and the rest of the §8 API contract to this schema — the SQL/RLS/RPC layer here works identically regardless of which backend language calls it.
