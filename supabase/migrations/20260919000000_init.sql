-- FutureWallet schema (PRD section 7). Every user-owned table has RLS: user_id = auth.uid().
-- All functions are SECURITY INVOKER so RLS applies to them exactly as it does to direct queries.

create table public.profiles (
  id             uuid primary key references auth.users (id) on delete cascade,
  name           text,
  monthly_income numeric(12, 2) not null default 0 check (monthly_income >= 0),
  fixed_costs    jsonb not null default '[]'::jsonb,
  persona        text not null default 'friendly' check (persona in ('friendly', 'roast', 'coach')),
  created_at     timestamptz not null default now()
);

create table public.expenses (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  amount     numeric(12, 2) not null check (amount > 0),
  category   text not null check (category in (
    'Food & Dining', 'Groceries', 'Transport', 'Shopping', 'Bills & Utilities', 'Rent & EMI',
    'Entertainment', 'Health', 'Education', 'Travel', 'Subscriptions', 'Other'
  )),
  merchant   text not null default '',
  note       text,
  spent_on   date not null,
  spent_at   time,
  source     text not null default 'manual' check (source in ('manual', 'nl', 'csv', 'seed')),
  created_at timestamptz not null default now()
);

create table public.budgets (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  month        date not null check (month = date_trunc('month', month)::date),
  category     text not null check (category in (
    'Food & Dining', 'Groceries', 'Transport', 'Shopping', 'Bills & Utilities', 'Rent & EMI',
    'Entertainment', 'Health', 'Education', 'Travel', 'Subscriptions', 'Other'
  )),
  limit_amount numeric(12, 2) not null check (limit_amount >= 0),
  reason       text,
  unique (user_id, month, category)
);

create table public.goals (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title         text not null,
  target_amount numeric(12, 2) not null check (target_amount > 0),
  saved_amount  numeric(12, 2) not null default 0 check (saved_amount >= 0),
  deadline      date not null,
  created_at    timestamptz not null default now()
);

create table public.insights (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind       text not null,
  body       text not null,
  created_at timestamptz not null default now()
);

create table public.chat_messages (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  role       text not null check (role in ('user', 'assistant')),
  content    text not null,
  created_at timestamptz not null default now()
);

-- Access patterns: expenses by user + date range, goals by user, insights/chat by user + recency.
-- (budgets is already covered by its unique (user_id, month, category) index.)
create index expenses_user_spent_on_idx on public.expenses (user_id, spent_on desc);
create index goals_user_idx             on public.goals (user_id);
create index insights_user_created_idx  on public.insights (user_id, created_at desc);
create index chat_user_created_idx      on public.chat_messages (user_id, created_at desc);

-- ---------------------------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------------------------
alter table public.profiles      enable row level security;
alter table public.expenses      enable row level security;
alter table public.budgets       enable row level security;
alter table public.goals         enable row level security;
alter table public.insights      enable row level security;
alter table public.chat_messages enable row level security;

create policy profiles_select on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy profiles_insert on public.profiles for insert to authenticated with check (id = (select auth.uid()));
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy expenses_all on public.expenses for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy budgets_all on public.budgets for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy goals_all on public.goals for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy insights_select on public.insights for select to authenticated using (user_id = (select auth.uid()));
create policy insights_insert on public.insights for insert to authenticated with check (user_id = (select auth.uid()));

create policy chat_select on public.chat_messages for select to authenticated using (user_id = (select auth.uid()));
create policy chat_insert on public.chat_messages for insert to authenticated with check (user_id = (select auth.uid()));

grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.expenses, public.budgets, public.goals to authenticated;
grant select, insert on public.insights, public.chat_messages to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Aggregation functions (mirrors lib/finance/aggregate.ts; a parity test keeps them in sync)
-- ---------------------------------------------------------------------------------------------

-- Dashboard aggregates for one month plus a zero-filled 6-month trend.
create or replace function public.spend_aggregates(
  p_month date,
  p_discretionary text[],
  p_late_from time default '23:00',
  p_late_until time default '04:00'
) returns jsonb
language sql stable security invoker set search_path = public
as $$
  with bounds as (
    select date_trunc('month', p_month)::date as m_start,
           (date_trunc('month', p_month) + interval '1 month')::date as m_end
  ),
  in_month as (
    select e.* from public.expenses e, bounds b
    where e.user_id = auth.uid() and e.spent_on >= b.m_start and e.spent_on < b.m_end
  ),
  months as (
    select (b.m_start - (n || ' months')::interval)::date as m
    from bounds b, generate_series(0, 5) n
  ),
  trend as (
    select to_char(mo.m, 'YYYY-MM') as month,
           coalesce(sum(e.amount), 0) as total,
           count(e.id) as count
    from months mo
    left join public.expenses e
      on e.user_id = auth.uid()
     and e.spent_on >= mo.m and e.spent_on < (mo.m + interval '1 month')::date
    group by mo.m
  ),
  cats as (
    select category, sum(amount) as total from in_month group by category
  ),
  merch as (
    select max(btrim(merchant) collate "C") as merchant, sum(amount) as total, count(*) as count
    from in_month
    where btrim(merchant) <> ''
    group by lower(btrim(merchant))
    order by sum(amount) desc, max(btrim(merchant) collate "C") asc
    limit 5
  )
  select jsonb_build_object(
    'total', coalesce((select sum(amount) from in_month), 0),
    'count', (select count(*) from in_month),
    'byCategory', coalesce((select jsonb_agg(jsonb_build_object('category', category, 'total', total)
                     order by total desc, category collate "C" asc) from cats), '[]'::jsonb),
    'topMerchants', coalesce((select jsonb_agg(jsonb_build_object('merchant', merchant, 'total', total, 'count', count)
                     order by total desc, merchant collate "C" asc) from merch), '[]'::jsonb),
    'trend', (select jsonb_agg(jsonb_build_object('month', month, 'total', total, 'count', count) order by month) from trend),
    'discretionaryTotal', coalesce((select sum(amount) from in_month where category = any (p_discretionary)), 0),
    'lateNightDiscretionary', coalesce((
      select sum(amount) from in_month
      where category = any (p_discretionary) and spent_at is not null
        and (spent_at >= p_late_from or spent_at < p_late_until)
    ), 0)
  );
$$;

-- Average monthly spend per category over the `p_months` calendar months before p_month,
-- divided by the number of those months that actually have data (min 1).
create or replace function public.category_averages(p_month date, p_months int default 3)
returns table (category text, avg numeric)
language sql stable security invoker set search_path = public
as $$
  with win as (
    select e.category, e.amount, date_trunc('month', e.spent_on) as m
    from public.expenses e
    where e.user_id = auth.uid()
      and e.spent_on >= (date_trunc('month', p_month) - (p_months || ' months')::interval)::date
      and e.spent_on <  date_trunc('month', p_month)::date
  ),
  denom as (select greatest(1, count(distinct m)) as n from win)
  select w.category, sum(w.amount) / (select n from denom) as avg
  from win w
  group by w.category
  order by w.category collate "C";
$$;

-- Atomic increment (no read-modify-write race). Returns no row when the goal is not the caller's.
create or replace function public.contribute_to_goal(p_goal_id uuid, p_amount numeric)
returns setof public.goals
language sql security invoker set search_path = public
as $$
  update public.goals
     set saved_amount = saved_amount + p_amount
   where id = p_goal_id and user_id = auth.uid() and p_amount > 0
  returning *;
$$;

-- Replace the caller's budget for one month atomically: listed categories are upserted, others removed.
create or replace function public.replace_budgets(p_month date, p_rows jsonb)
returns setof public.budgets
language plpgsql security invoker set search_path = public
as $$
begin
  delete from public.budgets
   where user_id = auth.uid() and month = p_month
     and category not in (select r->>'category' from jsonb_array_elements(p_rows) r);
  return query
  insert into public.budgets (user_id, month, category, limit_amount, reason)
  select auth.uid(), p_month, r->>'category', (r->>'limit')::numeric, r->>'reason'
  from jsonb_array_elements(p_rows) r
  on conflict (user_id, month, category)
  do update set limit_amount = excluded.limit_amount, reason = excluded.reason
  returning *;
end;
$$;

-- Idempotent, atomic demo seeding. A per-user advisory lock serialises double clicks; if the caller
-- already has seed expenses nothing is inserted and false is returned.
create or replace function public.seed_demo(
  p_profile jsonb, p_expenses jsonb, p_budget_month date, p_budgets jsonb, p_goals jsonb
) returns boolean
language plpgsql security invoker set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated'; end if;
  perform pg_advisory_xact_lock(hashtext(uid::text));
  if exists (select 1 from public.expenses where user_id = uid and source = 'seed') then
    return false;
  end if;

  insert into public.profiles (id, name, monthly_income, fixed_costs, persona)
  values (uid, p_profile->>'name', (p_profile->>'monthly_income')::numeric,
          coalesce(p_profile->'fixed_costs', '[]'::jsonb), coalesce(p_profile->>'persona', 'friendly'))
  on conflict (id) do update
    set name = coalesce(public.profiles.name, excluded.name),
        monthly_income = case when public.profiles.monthly_income > 0 then public.profiles.monthly_income
                              else excluded.monthly_income end,
        fixed_costs = case when public.profiles.fixed_costs = '[]'::jsonb then excluded.fixed_costs
                           else public.profiles.fixed_costs end;

  insert into public.expenses (user_id, amount, category, merchant, note, spent_on, spent_at, source)
  select uid, (r->>'amount')::numeric, r->>'category', r->>'merchant', r->>'note',
         (r->>'spent_on')::date, (r->>'spent_at')::time, 'seed'
  from jsonb_array_elements(p_expenses) r;

  insert into public.budgets (user_id, month, category, limit_amount, reason)
  select uid, p_budget_month, r->>'category', (r->>'limit')::numeric, r->>'reason'
  from jsonb_array_elements(p_budgets) r
  on conflict (user_id, month, category) do nothing;

  insert into public.goals (user_id, title, target_amount, saved_amount, deadline)
  select uid, r->>'title', (r->>'target_amount')::numeric, (r->>'saved_amount')::numeric, (r->>'deadline')::date
  from jsonb_array_elements(p_goals) r;

  return true;
end;
$$;

grant execute on function public.spend_aggregates(date, text[], time, time) to authenticated;
grant execute on function public.category_averages(date, int) to authenticated;
grant execute on function public.contribute_to_goal(uuid, numeric) to authenticated;
grant execute on function public.replace_budgets(date, jsonb) to authenticated;
grant execute on function public.seed_demo(jsonb, jsonb, date, jsonb, jsonb) to authenticated;
revoke execute on function public.seed_demo(jsonb, jsonb, date, jsonb, jsonb) from public, anon;
revoke execute on function public.replace_budgets(date, jsonb) from public, anon;
revoke execute on function public.contribute_to_goal(uuid, numeric) from public, anon;
