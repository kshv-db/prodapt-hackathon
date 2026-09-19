-- FutureWallet: BACKEND-OWNED SQL functions (Next.js route handlers call these via supabase.rpc).
--
-- This migration deliberately contains NO tables, columns, indexes, constraints or RLS policies:
-- all of that is owned by migrations 20260919000001..4 (feature/db). It only adds functions that the
-- API needs and that cannot be expressed as one plain PostgREST query:
--
--   spend_aggregates     dashboard totals/categories/merchants/6-month trend in ONE round trip (perf)
--   category_averages    3-month per-category averages (budget generation, goal cuts)
--   contribute_to_goal   atomic `saved_amount = saved_amount + x` (avoids a read-modify-write race)
--   replace_budgets      atomic "replace this month's budget" (PUT /budgets) - no half-applied state
--
-- All are SECURITY INVOKER, so the RLS policies from 20260919000003_rls.sql apply exactly as if the
-- caller had run the queries directly. Each also filters on auth.uid() explicitly (defence in depth).
-- Demo seeding is NOT here: use the canonical public.seed_demo_data() from 20260919000004.
-- Mirrors lib/finance/aggregate.ts (a parity test keeps SQL and TypeScript in sync).

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
    select e.amount, e.category::text as category, e.merchant, e.spent_at
    from public.expenses e, bounds b
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
    where btrim(coalesce(merchant, '')) <> ''
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
    select e.category::text as category, e.amount, date_trunc('month', e.spent_on) as m
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

-- Atomic increment. Returns no row when the goal is not the caller's or the amount is not positive.
create or replace function public.contribute_to_goal(p_goal_id uuid, p_amount numeric)
returns setof public.goals
language sql security invoker set search_path = public
as $$
  update public.goals
     set saved_amount = saved_amount + p_amount
   where id = p_goal_id and user_id = auth.uid() and p_amount > 0
  returning *;
$$;

-- Replace the caller's budget for one month atomically: listed categories are upserted (on the canonical
-- unique (user_id, month, category) key), all other categories for that month are removed.
create or replace function public.replace_budgets(p_month date, p_rows jsonb)
returns setof public.budgets
language plpgsql security invoker set search_path = public
as $$
begin
  delete from public.budgets
   where user_id = auth.uid() and month = p_month
     and category::text not in (select r->>'category' from jsonb_array_elements(p_rows) r);
  return query
  insert into public.budgets (user_id, month, category, limit_amount, reason)
  select auth.uid(), p_month, (r->>'category')::public.expense_category, (r->>'limit')::numeric, r->>'reason'
  from jsonb_array_elements(p_rows) r
  on conflict (user_id, month, category)
  do update set limit_amount = excluded.limit_amount, reason = excluded.reason
  returning *;
end;
$$;

revoke execute on function public.contribute_to_goal(uuid, numeric) from public, anon;
revoke execute on function public.replace_budgets(date, jsonb) from public, anon;
grant execute on function public.spend_aggregates(date, text[], time, time) to authenticated;
grant execute on function public.category_averages(date, int) to authenticated;
grant execute on function public.contribute_to_goal(uuid, numeric) to authenticated;
grant execute on function public.replace_budgets(date, jsonb) to authenticated;
