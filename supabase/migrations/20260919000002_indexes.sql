-- FutureWallet: indexes for the actual access patterns in the API contract.
--
-- `budgets_user_month_category_unique` (from the previous migration) already
-- creates a btree index on (user_id, month, category), which also serves
-- "budgets for a user/month" lookups via its leftmost-column prefix — so no
-- separate budgets index is added here to avoid redundant write overhead.

-- Dashboard: expenses for a user in a given month range, and recent-first lists.
create index expenses_user_spent_on_idx on public.expenses (user_id, spent_on desc);
create index expenses_user_created_at_idx on public.expenses (user_id, created_at desc);

-- Dashboard: category donut / top-merchant aggregation scoped to one user.
create index expenses_user_category_idx on public.expenses (user_id, category);

-- Goals list for a user.
create index goals_user_idx on public.goals (user_id);

-- Advisor chat: last N turns for a user, chronological.
create index chat_messages_user_created_at_idx on public.chat_messages (user_id, created_at desc);

-- Insight history for a user, most recent first.
create index insights_user_created_at_idx on public.insights (user_id, created_at desc);
