-- Which of the two raise paths a person may use: "Pay a vendor" and
-- "Buy or repair".
--
-- Modelled on user_expense_access deliberately — same shape, same policies —
-- because this is the third answer to the same question ("what may this person
-- raise?") and a third pattern would be a third thing to reason about.
--
-- No grants means nothing, matching branches and expense types. That strict
-- reading is the point: a new joiner gets no raise paths until someone says
-- otherwise. Admins, approvers and accounts bypass it, exactly as they bypass
-- the other two lists.

do $$ begin
  create type raise_module as enum ('payment', 'procurement');
exception when duplicate_object then null;
end $$;

create table if not exists public.user_module_access (
  user_id uuid not null references public.profiles(id) on delete cascade,
  module raise_module not null,
  granted_at timestamptz not null default now(),
  primary key (user_id, module)
);

alter table public.user_module_access enable row level security;

drop policy if exists module_access_read on public.user_module_access;
create policy module_access_read on public.user_module_access
  for select using (true);

drop policy if exists module_access_admin on public.user_module_access;
create policy module_access_admin on public.user_module_access
  for all using (has_role('admin'::user_role)) with check (has_role('admin'::user_role));

-- Backfill BOTH modules for everyone who already exists.
--
-- Without this the migration would silently take both raise buttons away from
-- every restricted requester the moment it ran — a live app losing a feature
-- because a permission it never had is suddenly required. Today's behaviour is
-- preserved; only people added from here on need an explicit grant.
insert into public.user_module_access (user_id, module)
select p.id, m.module
  from public.profiles p
  cross join (values ('payment'::raise_module), ('procurement'::raise_module)) as m(module)
on conflict do nothing;
