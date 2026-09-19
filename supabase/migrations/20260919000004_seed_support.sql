-- FutureWallet: demo seed support.
--
-- `POST /api/demo/seed` (backend) should call this function via RPC using the
-- signed-in user's own client (`supabase.rpc('seed_demo_data')`), NOT the
-- service-role key. It is SECURITY INVOKER, so it runs as the calling user
-- and every insert/delete still passes through the RLS policies from the
-- previous migration — the function centralizes seed *generation*, it does
-- not bypass ownership checks.
--
-- Idempotency strategy (see docs/database.md for detail): rerunning this
-- function for the same user replaces the prior demo dataset instead of
-- piling up duplicates, without ever touching the user's real data:
--   * expenses  -> deleted/reinserted by source = 'seed' only
--   * budgets   -> upserted on the existing (user_id, month, category) key
--   * goals     -> deleted/reinserted by a fixed set of demo titles
create or replace function public.seed_demo_data()
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid               uuid := auth.uid();
  v_income            numeric(12, 2);
  v_month_start       date;
  v_month_offset      int;
  v_i                 int;
  v_day               int;
  v_amount            numeric(12, 2);
  v_count             int;
  v_min_amt           numeric;
  v_max_amt           numeric;
  v_row               text[];
  v_inserted_expenses int := 0;
  v_inserted_budgets  int := 0;
  demo_categories     text[] := array[
    -- [category, min_count_per_month, max_count_per_month, min_amount, max_amount]
    ['Food & Dining', '6', '9', '150', '420'],
    ['Groceries', '3', '4', '700', '2100'],
    ['Transport', '9', '13', '60', '240'],
    ['Shopping', '2', '3', '450', '2800'],
    ['Bills & Utilities', '1', '1', '1400', '2600'],
    ['Rent & EMI', '1', '1', '11000', '16000'],
    ['Entertainment', '2', '3', '300', '850'],
    ['Health', '0', '1', '300', '1400'],
    ['Subscriptions', '2', '3', '150', '600'],
    ['Other', '1', '2', '200', '750']
  ];
  budget_share        constant jsonb := '{
    "Food & Dining": 0.14, "Groceries": 0.08, "Transport": 0.08,
    "Shopping": 0.06, "Bills & Utilities": 0.06, "Rent & EMI": 0.30,
    "Entertainment": 0.03, "Health": 0.03, "Subscriptions": 0.02, "Other": 0.02
  }'::jsonb;
begin
  if v_uid is null then
    raise exception 'seed_demo_data requires an authenticated user';
  end if;

  if not exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'No profile found for this user; complete onboarding before loading demo data';
  end if;

  select coalesce(nullif(monthly_income, 0), 45000) into v_income
  from public.profiles where id = v_uid;

  -- Clear only this user's prior demo rows (never manually entered data).
  delete from public.expenses where user_id = v_uid and source = 'seed';
  delete from public.goals where user_id = v_uid and title in ('New Laptop', 'Emergency Fund');

  -- Three months of everyday spending: current month and the two before it.
  for v_month_offset in 0..2 loop
    v_month_start := date_trunc('month', current_date - (v_month_offset || ' months')::interval)::date;

    foreach v_row slice 1 in array demo_categories loop
      v_count   := v_row[2]::int + trunc(random() * (v_row[3]::int - v_row[2]::int + 1))::int;
      v_min_amt := v_row[4]::numeric;
      v_max_amt := v_row[5]::numeric;

      for v_i in 1..v_count loop
        v_day    := least(27, trunc(random() * 28)::int);
        v_amount := round((v_min_amt + random() * (v_max_amt - v_min_amt))::numeric, 2);

        insert into public.expenses (user_id, amount, category, merchant, note, spent_on, spent_at, source)
        values (
          v_uid,
          v_amount,
          v_row[1],
          case v_row[1]
            when 'Food & Dining' then (array['Zomato', 'Swiggy', 'Local Cafe'])[1 + trunc(random() * 3)::int]
            when 'Groceries' then (array['BigBasket', 'Blinkit', 'Local Store'])[1 + trunc(random() * 3)::int]
            when 'Transport' then (array['Uber', 'Ola', 'Metro'])[1 + trunc(random() * 3)::int]
            when 'Shopping' then (array['Amazon', 'Myntra'])[1 + trunc(random() * 2)::int]
            when 'Subscriptions' then (array['Netflix', 'Spotify', 'YouTube Premium'])[1 + trunc(random() * 3)::int]
            else null
          end,
          null,
          (v_month_start + (v_day || ' days')::interval)::date,
          (time '09:00' + (trunc(random() * 12)::int || ' hours')::interval),
          'seed'
        );
        v_inserted_expenses := v_inserted_expenses + 1;
      end loop;
    end loop;

    -- Deliberate late-night (>= 23:00) food-order pattern per month, so the
    -- health score's impulse-control component has something real to catch.
    for v_i in 1..(3 + trunc(random() * 2)::int) loop
      v_day    := least(27, trunc(random() * 28)::int);
      v_amount := round((250 + random() * 300)::numeric, 2);

      insert into public.expenses (user_id, amount, category, merchant, note, spent_on, spent_at, source)
      values (
        v_uid,
        v_amount,
        'Food & Dining',
        (array['Zomato', 'Swiggy'])[1 + trunc(random() * 2)::int],
        'Late-night order',
        (v_month_start + (v_day || ' days')::interval)::date,
        (time '23:00' + (trunc(random() * 59)::int || ' minutes')::interval),
        'seed'
      );
      v_inserted_expenses := v_inserted_expenses + 1;
    end loop;
  end loop;

  -- One active budget per category for the current month, sized off income.
  v_month_start := date_trunc('month', current_date)::date;
  foreach v_row slice 1 in array demo_categories loop
    insert into public.budgets (user_id, month, category, limit_amount, reason)
    values (
      v_uid,
      v_month_start,
      v_row[1],
      round((v_income * (budget_share ->> v_row[1])::numeric)::numeric, 2),
      'Demo budget generated from income allocation'
    )
    on conflict (user_id, month, category)
    do update set limit_amount = excluded.limit_amount, reason = excluded.reason;
    v_inserted_budgets := v_inserted_budgets + 1;
  end loop;

  -- Two demo goals.
  insert into public.goals (user_id, title, target_amount, saved_amount, deadline)
  values
    (v_uid, 'New Laptop', 55000, 12000, (current_date + interval '6 months')::date),
    (v_uid, 'Emergency Fund', 30000, 6000, (current_date + interval '12 months')::date);

  return jsonb_build_object(
    'expenses_inserted', v_inserted_expenses,
    'budgets_upserted', v_inserted_budgets,
    'goals_inserted', 2,
    'seeded_for', v_uid
  );
end;
$$;

revoke execute on function public.seed_demo_data() from public;
grant execute on function public.seed_demo_data() to authenticated;
