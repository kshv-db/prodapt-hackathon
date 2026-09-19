# FutureWallet backend

Single source of truth: `FutureWallet-PRD.md` (sections 6-9). **Code calculates, AI explains.**

```
Browser -> Next.js route handlers (/app/api) -> apiRoute(): Supabase Auth (JWT verified) -> per-user Store
                                                    |                                         |
                                            zod validation                         Supabase Postgres (RLS)
                                                    |
                              lib/finance (pure math) -> fact sheet -> lib/ai (OpenAI, server only)
```

## Modules

| Path | Responsibility |
|---|---|
| `lib/finance/*` | Pure, deterministic, unit-tested: `projection`, `goals`, `health`, `budget`, `savings`, `whatif`, `aggregate`, `dates`, `money`, `categories` (the ONE category list). No DB, no AI. |
| `lib/ai/*` | OpenAI client + `config.ts` (model IDs), `personas.ts`, `prompts.ts` (security + grounding rules), `structured.ts` (schema -> validate -> retry once -> safe error), `grounding.ts` (numeric check of generated prose), `expense-parser`, `categorizer`, `budget-reasons`, `narrator` (grounded prose + deterministic fallback), `chat`. |
| `lib/server/*` | `store.ts` (data-access interface, bound to ONE user), `supabase-store.ts`, `analytics.ts` (snapshot of derived numbers), `fact-sheet.ts` (`buildFinancialFactSheet`), `services.ts` (summary, budgets, goal plan, Future You, what-if, insight, seed), `seed-data.ts`. |
| `lib/api/*` | `apiRoute()` wrapper (auth + error mapping), `schemas.ts` (all request validation), `rate-limit.ts`. |
| `supabase/migrations/20260919000000_init.sql` | Tables, checks, indexes, RLS, SQL functions. |

## Request flow

1. `apiRoute` authenticates: cookie session (browser) or `Authorization: Bearer <jwt>`; Supabase verifies the JWT. **User id comes only from here.**
2. Body/query validated with zod (`{ "error": "<field>: <message>" }` + 400 on failure; unknown keys such as `user_id` are dropped).
3. The handler receives a `Store` bound to that user. It is created with the **anon key + the user's JWT, so Postgres RLS applies to every query**. There is no service-role key anywhere.
4. Numbers come from `lib/finance`; the AI only receives the computed fact sheet.

## Endpoints (all under `/api`, all require a signed-in user, all errors are `{ "error": string }`)

Fields marked **(+)** are additive to the PRD table (optional to consume).

| Endpoint | Request | Response |
|---|---|---|
| `POST /expenses/parse` | `{ text, today: "YYYY-MM-DD" }` | `{ amount, category, merchant, spent_on, confidence, needs_clarification?, spent_at?(+) }`. Missing/ambiguous amount => `amount: 0` + `needs_clarification` (never a guess). Relative dates resolve against `today`. |
| `POST /expenses` | `{ amount>0, category, merchant, spent_on, note?, source, spent_at?(+ "HH:MM") }` | `201 { expense }` |
| `GET /expenses` | `?month=YYYY-MM` (default: current month, IST) | `{ expenses[] }` |
| `DELETE /expenses/:id` | - | `{ ok: true }` (404 if missing or not yours) |
| `POST /expenses/import` | multipart, field `file` = CSV (`date,description,amount`, max 500 rows / 1 MB) | `{ rows: [{ date, description, amount, category, confidence, needs_review(+) }], skipped(+): [{ line, reason }] }`. Nothing is saved; the client saves confirmed rows via `POST /expenses` with `source: "csv"`. `needs_review` = confidence < 0.7. |
| `GET /summary` | `?month=YYYY-MM` | `{ total, income, byCategory: [{category,total,percent}], trend: [{month,total}] (6, oldest first, zero-filled), topMerchants: [{merchant,total,count}] (<=5), budgetUsage: [{category,limit,spent,percent,status:"ok"\|"warning"\|"over"}], healthScore (0-100 int), healthReason, month(+), budgetTotal(+), healthBreakdown(+): {savings,budget,goals,impulse}: {points,max}, insight(+): {id,kind,body,created_at}\|null }` |
| `POST /budget/generate` | `{ income, fixedCosts: [{ name, amount, category? }] }` | `{ budgets: [{ category, limit, reason }] (all 12), savings(+): { limit, reason }, totals(+) }`. Computes only; does **not** save. `sum(limits) + savings.limit == income`. |
| `GET /budgets` | `?month=YYYY-MM` | `{ budgets: [{ category, limit, reason }] }` |
| `PUT /budgets` | `{ budgets: [{ category, limit>=0, reason? }], month?(+) }` (month also via `?month=`) | `{ budgets[] }`. **Replaces** that month's budget with the list. 400 if total > monthly income, income unset, duplicate categories. |
| `GET /goals` | - | `{ goals[] }` (DB shape: `id,title,target_amount,saved_amount,deadline,created_at`) |
| `POST /goals` | `{ title, target>0, deadline }` (deadline not in the past) | `201 { goal }` |
| `POST /goals/:id/contribute` | `{ amount>0 }` | `{ goal }` (atomic increment) |
| `GET /goals/:id/plan` | - | `{ monthlyNeeded, onTrack, gap, suggestion, monthsLeft(+), remaining(+), status(+): "active"\|"completed"\|"due_today"\|"expired", currentMonthlySavings(+), cut(+): {category,amount}\|null }` |
| `POST /future` | `{ monthlySaving 0..20000, years 1..30 (int) }` | `{ current: { series: [{month,balance}] }, chosen: { series }, narrative, currentMonthlySaving(+), assumedAnnualReturn(+): 0.07, narrativeSource(+): "ai"\|"fallback", disclaimer(+) }`. Series has `years*12+1` points (month 0..N). **No DB writes.** |
| `POST /whatif` | `{ description, monthlyCost>0, months (int 1..120) }` | `{ budgetImpact, goalDelays[], narrative }` (see shapes below) |
| `POST /chat` | `{ message (<=1000 chars) }` | Streamed `text/plain` (UTF-8). Persists both turns. |
| `GET /chat` (+) | - | `{ messages: [{ id, role, content, created_at }] }` (last 50, oldest first) |
| `POST /insights/refresh` | - | `{ insight: { id, kind: "dashboard", body, created_at } }` (persisted) |
| `PUT /profile` | `{ name?, income?, fixedCosts?, persona? }` (any subset, >=1 field) | `{ profile }` (DB shape: `id,name,monthly_income,fixed_costs,persona,created_at`). Upserts, so this is also the onboarding call. |
| `GET /profile` (+) | - | `{ profile \| null }` |
| `POST /demo/seed` | - | `{ ok: true }`. Idempotent (a second click inserts nothing). |

`budgetImpact`: `{ monthlyCost, months, totalCost, incomeShare, savingsBefore, savingsAfter, shortfall, savingsRateBefore, savingsRateAfter }`.
`goalDelays[]`: `{ goalId, title, monthsBefore|null, monthsAfter|null, delayMonths|null, missesDeadline, missedDeadlineBefore }` (null = unreachable at current savings).

Status codes: 400 invalid input, 401 unauthenticated, 404 not found / not yours, 409 conflict, 429 rate limit (AI routes: 40/min/user per instance, or OpenAI busy), 500 unexpected (generic body), 502 AI unusable, 503 AI not configured.

## Contract gaps in the PRD (decisions taken; please confirm with the team)

The PRD fixes endpoint names and top-level keys but not these inner shapes. Nothing was renamed; these are the choices:

1. `fixedCosts[]` item = `{ name: string, amount: number, category?: Category }` (also stored in `profiles.fixed_costs`).
2. `budgets[]` item = `{ category, limit, reason }` (API says `limit`; column is `limit_amount`).
3. The "savings line" is **not** a category (the 12-category list is fixed). It is returned as `savings` next to `budgets` from `/budget/generate` and equals `income - sum(limits)`; it is not stored.
4. `PUT /budgets` needs a month: `?month=`, `body.month`, else current month.
5. Row shapes for `expense`, `goal`, `profile` are the DB rows (snake_case) since the PRD request for expenses is already snake_case.
6. `/summary` inner shapes (`byCategory`, `trend`, `topMerchants`, `budgetUsage`) as tabulated above.
7. `series[]` item = `{ month, balance }` (so the client can draw an x-axis in months).
8. `POST /expenses/parse` with no amount returns `amount: 0` (keeps the field a number) plus `needs_clarification`.
9. Additive: `GET /profile`, `GET /chat`, `spent_at` on expenses (needed for the late-night impulse component), `summary.insight`.
10. DELETE/plan/contribute on another user's id returns **404**, not 403: RLS makes foreign rows indistinguishable from missing ones (avoids leaking existence).
11. Schema: **no changes** to the PRD tables. Added only CHECK constraints (amount > 0, category list, persona, source, role, first-of-month), `user_id default auth.uid()`, indexes, and SQL functions.

## Finance rules that the PRD leaves open (all in `lib/finance`, all unit-tested)

- **Savings baseline** ("average of income - spend over the last 3 months"): the 3 calendar months before the current month that have any expenses (empty months are "no data", not "saved everything"); falls back to current month-to-date if there is no history; floored at 0.
- **Goal**: `monthsLeft` = whole calendar months to the deadline, rounded up. `monthlyNeeded = remaining / max(1, monthsLeft)`. Completed => on track, expired => never on track, deadline today => needs the full remainder now. Never divides by zero.
- **Health score**: savings 40 (linear, full at >=20%), budget 30 (`30 * (1 - overspend/total limits)`), goals 20 (share on track), impulse 10 (full at <=10% late-night discretionary share, linear to 0 at 30%). **No budget / no goals => neutral half points** (15 / 10), so users cannot earn free points. Late night = 23:00-03:59. Discretionary = Food & Dining, Shopping, Entertainment, Travel, Subscriptions.
- **Budget warning status**: `warning` at >= 80% of a limit, `over` at >= 100%.
- **Budget generation**: fixed costs are exact; savings target 20% of income; flexible categories from 3-month averages (discretionary trimmed 10%) or a default split when there is no history; scaled down to fit; limits floored to multiples of 10; leftover goes to the savings line.
- **Rounding**: money is `numeric(12,2)`. Sums use integer paise; values are rounded to 2 decimals only when returned. Projection runs at full precision and only rounds the exposed balance.
- **Returns**: 7% p.a. is an assumption (`assumedAnnualReturn`), always labelled as such.

## AI safety design

- Only `lib/ai` talks to OpenAI, server-side; models in `lib/ai/config.ts` (override with `OPENAI_MODEL_FAST` / `OPENAI_MODEL_MID`).
- Structured tasks (parse, categorize, budget reasons) use JSON-schema mode **and** zod validation; invalid => retry once => safe fallback (parse: clarification; categorize: `Other`/confidence 0; budget: deterministic reasons).
- Prose tasks (insight, Future You, plan suggestion, what-if) go through `narrate()`: the model gets the computed facts; the output is checked so every rupee amount / percentage / figure >= 100 exists in those facts (and word limits hold); retry once; else a deterministic grounded sentence. `narrativeSource` tells you which one you got.
- Amounts in parsed expenses must literally appear in the user's text; dates are resolved in code from a model-provided *description* of the date phrase.
- User text is never placed in a system prompt. Chat = system rules + system FACTS (sanitised strings, JSON-escaped) + last 10 turns + the new message as a user message. The model has no tools and cannot write to the DB.

## Environment variables (names only)

`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `OPENAI_API_KEY`, optional `OPENAI_MODEL_FAST`, `OPENAI_MODEL_MID`. See `.env.example`.

## Setup

1. Create a Supabase project; run `supabase/migrations/20260919000000_init.sql` (SQL editor or `supabase db push`).
2. Copy `.env.example` to `.env.local` and fill it in.
3. `npm run dev`. Sign in with Supabase Auth on the frontend (`lib/supabase/browser.ts`), then call `/api/*`.

## Tests

`npm test` runs: finance unit tests, AI-layer tests (mock model), route-level flow tests (in-memory store, mock model), and DB tests on real Postgres (PGlite) that apply the actual migration and check RLS, constraints, SQL/TS aggregate parity and seed idempotency. `tests/live/parse-eval.test.ts` (18/20 parse accuracy) runs only when `OPENAI_API_KEY` is set.
