-- Per-user branch and expense-type access, and expense type as real data.
--
-- The CapEx / OpEx selector on the Raise form was decorative: CapEx was
-- hard-coded and OpEx was disabled, and nothing was ever stored. Every
-- request raised so far is CapEx, so that's the backfill.
--
-- Access here governs RAISING only. What someone can see, approve or pay is
-- unchanged — those are already decided by role, and narrowing them would
-- hide in-flight payments from the people chasing them.

do $$ begin
  create type expense_type as enum ('capex', 'opex');
exception when duplicate_object then null;
end $$;

alter table public.payment_requests
  add column if not exists expense_type expense_type not null default 'capex';

comment on column public.payment_requests.expense_type is
  'CapEx (assets, construction) or OpEx (rent, utilities). Everything raised before this column existed was CapEx.';

-- ---------------------------------------------------------------------------
-- Which branches a person may raise for.

create table if not exists public.user_branch_access (
  user_id uuid not null references auth.users (id) on delete cascade,
  outlet_id uuid not null references public.outlets (id) on delete cascade,
  granted_at timestamptz not null default now(),
  primary key (user_id, outlet_id)
);

create index if not exists user_branch_access_user_idx on public.user_branch_access (user_id);

-- Which expense types a person may raise.
create table if not exists public.user_expense_access (
  user_id uuid not null references auth.users (id) on delete cascade,
  expense_type expense_type not null,
  granted_at timestamptz not null default now(),
  primary key (user_id, expense_type)
);

alter table public.user_branch_access enable row level security;
alter table public.user_expense_access enable row level security;

-- Everyone can read the grants — the Raise form needs to know what to offer,
-- and knowing who covers which branch is not sensitive. Only admins change
-- them, and only through the service-role client after a TypeScript check.
drop policy if exists branch_access_read on public.user_branch_access;
create policy branch_access_read on public.user_branch_access
  for select to authenticated using (true);

drop policy if exists expense_access_read on public.user_expense_access;
create policy expense_access_read on public.user_expense_access
  for select to authenticated using (true);

drop policy if exists branch_access_admin on public.user_branch_access;
create policy branch_access_admin on public.user_branch_access
  for all to authenticated
  using (has_role('admin'::user_role))
  with check (has_role('admin'::user_role));

drop policy if exists expense_access_admin on public.user_expense_access;
create policy expense_access_admin on public.user_expense_access
  for all to authenticated
  using (has_role('admin'::user_role))
  with check (has_role('admin'::user_role));

-- ---------------------------------------------------------------------------
-- Enforcement at the database, so a hand-made request can't skip it.
--
-- No grants means no raising — that was the deliberate choice. Admins are
-- exempt, or a fresh install would have nobody able to set anything up.

create or replace function public.may_raise_for_outlet(p_outlet_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select has_role('admin'::user_role)
     or exists (
       select 1 from public.user_branch_access a
       where a.user_id = (select auth.uid()) and a.outlet_id = p_outlet_id
     );
$$;

create or replace function public.may_raise_expense(p_type expense_type)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select has_role('admin'::user_role)
     or exists (
       select 1 from public.user_expense_access a
       where a.user_id = (select auth.uid()) and a.expense_type = p_type
     );
$$;

-- A thread needs at least one branch grant to exist at all. Without this the
-- branch check lives only on request_outlets, so someone with no branches
-- could create the thread and simply fail to attach an outlet — leaving an
-- orphan row that the app's own validation would never have allowed.
create or replace function public.may_raise_any_branch()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select has_role('admin'::user_role)
     or exists (
       select 1 from public.user_branch_access a where a.user_id = (select auth.uid())
     );
$$;

drop policy if exists requests_insert on public.payment_requests;
create policy requests_insert on public.payment_requests
  for insert to authenticated
  with check (
    submitter_id = (select auth.uid())
    and has_any_role(array['requester'::user_role, 'admin'::user_role])
    and public.may_raise_expense(expense_type)
    and public.may_raise_any_branch()
  );

-- The branch check lives on the join row, which is where the branch is.
drop policy if exists req_outlets_insert on public.request_outlets;
create policy req_outlets_insert on public.request_outlets
  for insert to authenticated
  with check (
    public.thread_is_editable(request_id)
    and (
      -- Staff editing someone else's thread aren't constrained by their own
      -- branch grants; this is about who may raise, not who may correct.
      has_any_role(array['approver'::user_role, 'accounts'::user_role, 'admin'::user_role])
      or public.may_raise_for_outlet(outlet_id)
    )
  );
