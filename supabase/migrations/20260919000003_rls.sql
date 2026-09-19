-- FutureWallet: Row Level Security.
--
-- Baseline rule for every table: a row is visible/writable only to the
-- authenticated user who owns it (profiles: id = auth.uid(); everything
-- else: user_id = auth.uid()). No policy in this file ever evaluates to
-- `true` unconditionally, and no anonymous/public access is granted.
-- Service-role keys (server-only) bypass RLS by Supabase design; backend
-- code using the service role must still filter by the intended user_id
-- itself (see docs/database.md).

alter table public.profiles       enable row level security;
alter table public.expenses       enable row level security;
alter table public.budgets        enable row level security;
alter table public.goals          enable row level security;
alter table public.insights       enable row level security;
alter table public.chat_messages  enable row level security;

-- ---------------------------------------------------------------------------
-- profiles: select/insert/update own row only. No delete policy — a profile
-- is removed only as a side effect of the auth.users row being deleted
-- (on delete cascade), never by direct user action.
-- ---------------------------------------------------------------------------
create policy "profiles_select_own"
  on public.profiles for select
  to authenticated
  using (id = auth.uid());

create policy "profiles_insert_own"
  on public.profiles for insert
  to authenticated
  with check (id = auth.uid());

create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- ---------------------------------------------------------------------------
-- expenses: full CRUD on own rows (add, edit, delete a logged expense).
-- ---------------------------------------------------------------------------
create policy "expenses_select_own"
  on public.expenses for select
  to authenticated
  using (user_id = auth.uid());

create policy "expenses_insert_own"
  on public.expenses for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "expenses_update_own"
  on public.expenses for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "expenses_delete_own"
  on public.expenses for delete
  to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- budgets: full CRUD on own rows. `PUT /budgets` edits limits per category
-- and demo reseeding upserts by (user_id, month, category), so update and
-- delete are both legitimate app operations, always scoped to the owner.
-- ---------------------------------------------------------------------------
create policy "budgets_select_own"
  on public.budgets for select
  to authenticated
  using (user_id = auth.uid());

create policy "budgets_insert_own"
  on public.budgets for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "budgets_update_own"
  on public.budgets for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "budgets_delete_own"
  on public.budgets for delete
  to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- goals: full CRUD on own rows (create, contribute/update, remove a goal).
-- ---------------------------------------------------------------------------
create policy "goals_select_own"
  on public.goals for select
  to authenticated
  using (user_id = auth.uid());

create policy "goals_insert_own"
  on public.goals for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "goals_update_own"
  on public.goals for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "goals_delete_own"
  on public.goals for delete
  to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- insights: read + create own rows only. No update/delete policy — insights
-- are an append-only history; nothing in the PRD requires editing/removing one.
-- ---------------------------------------------------------------------------
create policy "insights_select_own"
  on public.insights for select
  to authenticated
  using (user_id = auth.uid());

create policy "insights_insert_own"
  on public.insights for insert
  to authenticated
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- chat_messages: read + create own rows only. No update/delete policy —
-- chat history is append-only; the PRD names no edit/delete requirement.
-- ---------------------------------------------------------------------------
create policy "chat_messages_select_own"
  on public.chat_messages for select
  to authenticated
  using (user_id = auth.uid());

create policy "chat_messages_insert_own"
  on public.chat_messages for insert
  to authenticated
  with check (user_id = auth.uid());
