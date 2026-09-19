-- FutureWallet: initial schema.
-- Tables, ownership FKs to auth.users, and core integrity constraints.
-- See docs/database.md for the full design rationale.

create extension if not exists pgcrypto; -- gen_random_uuid()

-- ---------------------------------------------------------------------------
-- Shared category domain.
--
-- `category` is used by both `expenses` and `budgets`. A DOMAIN centralizes
-- the allowed value list in one place: adding/removing a category later is
-- one `ALTER DOMAIN ... DROP CONSTRAINT` + `ADD CONSTRAINT` instead of
-- touching every table that has a category column. A native Postgres ENUM
-- was considered but rejected because `ALTER TYPE ... ADD VALUE` cannot run
-- inside the same transaction as other DDL/back-fills, which makes future
-- migrations more awkward than a domain's plain CHECK constraint.
-- ---------------------------------------------------------------------------
create domain public.expense_category as text
  check (
    value in (
      'Food & Dining',
      'Groceries',
      'Transport',
      'Shopping',
      'Bills & Utilities',
      'Rent & EMI',
      'Entertainment',
      'Health',
      'Education',
      'Travel',
      'Subscriptions',
      'Other'
    )
  );

-- ---------------------------------------------------------------------------
-- profiles: one row per authenticated user, same id as auth.users.
-- ---------------------------------------------------------------------------
create table public.profiles (
  id             uuid primary key references auth.users (id) on delete cascade,
  name           text not null,
  monthly_income numeric(12, 2) not null default 0
                   constraint profiles_monthly_income_non_negative check (monthly_income >= 0),
  fixed_costs    jsonb not null default '[]'::jsonb,
  persona        text not null default 'friendly'
                   constraint profiles_persona_valid check (persona in ('friendly', 'roast', 'coach')),
  created_at     timestamptz not null default now()
);

comment on table public.profiles is
  'One row per authenticated user (id = auth.users.id). Never created for a non-authenticated identity.';
comment on column public.profiles.fixed_costs is
  'jsonb array of {"label": text, "amount": number}, e.g. [{"label":"Rent","amount":12000}]. Shape owned by the backend/finance layer.';

-- ---------------------------------------------------------------------------
-- expenses
-- ---------------------------------------------------------------------------
create table public.expenses (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  amount     numeric(12, 2) not null
               constraint expenses_amount_positive check (amount > 0),
  category   public.expense_category not null,
  merchant   text,
  note       text,
  spent_on   date not null,
  spent_at   time,
  source     text not null default 'manual'
               constraint expenses_source_valid check (source in ('manual', 'nl', 'csv', 'seed')),
  created_at timestamptz not null default now()
);

comment on table public.expenses is 'User-logged expenses. Isolated per user via RLS.';
comment on column public.expenses.spent_at is
  'Time-of-day only (date lives in spent_on). Used for late-night (>= 23:00) impulse-spend detection.';

-- ---------------------------------------------------------------------------
-- budgets: one row per user + month + category.
-- `month` is stored as the first day of the month (date) and always maps
-- 1:1 to the API's "YYYY-MM" representation via date_trunc/to_char.
-- ---------------------------------------------------------------------------
create table public.budgets (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  month        date not null
                 constraint budgets_month_is_first_of_month check (date_trunc('month', month)::date = month),
  category     public.expense_category not null,
  limit_amount numeric(12, 2) not null default 0
                 constraint budgets_limit_non_negative check (limit_amount >= 0),
  reason       text,
  created_at   timestamptz not null default now(),
  constraint budgets_user_month_category_unique unique (user_id, month, category)
);

comment on table public.budgets is
  'Per-category monthly limits. `month` is normalized to the 1st of the month; format as YYYY-MM at the API boundary.';

-- ---------------------------------------------------------------------------
-- goals
-- ---------------------------------------------------------------------------
create table public.goals (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  title         text not null,
  target_amount numeric(12, 2) not null
                  constraint goals_target_positive check (target_amount > 0),
  saved_amount  numeric(12, 2) not null default 0
                  constraint goals_saved_non_negative check (saved_amount >= 0),
  deadline      date not null,
  created_at    timestamptz not null default now()
);

comment on table public.goals is 'Savings goals with running saved_amount. Progress math lives in /lib/finance, not here.';

-- ---------------------------------------------------------------------------
-- insights: persisted AI-generated insight text.
-- ---------------------------------------------------------------------------
create table public.insights (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  kind       text not null,
  body       text not null,
  created_at timestamptz not null default now()
);

comment on table public.insights is 'AI-generated insight text, one row per generation. History is retained, not overwritten.';

-- ---------------------------------------------------------------------------
-- chat_messages: advisor chat history.
-- ---------------------------------------------------------------------------
create table public.chat_messages (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       text not null
               constraint chat_messages_role_valid check (role in ('user', 'assistant')),
  content    text not null,
  created_at timestamptz not null default now()
);

comment on table public.chat_messages is
  'Advisor chat turns. Only user/assistant turns are stored; system prompts are not persisted as rows.';
