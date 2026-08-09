-- Supporting documents and CC on a procurement request.
--
-- attachments already allows a null request_id, so it gains a second parent
-- rather than being duplicated. A row carries one or the other, enforced
-- below — a polymorphic parent is only dangerous when nothing stops both being
-- set at once.
alter table public.attachments
  add column if not exists procurement_request_id uuid
    references public.procurement_requests(id) on delete cascade;

do $$ begin
  alter table public.attachments
    add constraint attachments_one_parent check (
      (request_id is not null and procurement_request_id is null)
      or (request_id is null and procurement_request_id is not null)
      or (request_id is null and procurement_request_id is null)
    );
exception when duplicate_object then null;
end $$;

create index if not exists attachments_procurement_idx
  on public.attachments (procurement_request_id);

-- CC gets its own table rather than reusing request_watchers, whose primary
-- key is (request_id, user_id) with request_id NOT NULL. Widening that would
-- mean dropping and rebuilding the key on a table the payment side depends on,
-- to save one small table.
create table if not exists public.procurement_watchers (
  procurement_request_id uuid not null
    references public.procurement_requests(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  added_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (procurement_request_id, user_id)
);
create index if not exists procurement_watchers_user_idx
  on public.procurement_watchers (user_id);

alter table public.procurement_watchers enable row level security;

drop policy if exists proc_watchers_select on public.procurement_watchers;
create policy proc_watchers_select on public.procurement_watchers
  for select using (
    exists (select 1 from public.procurement_requests r where r.id = procurement_request_id)
  );

drop policy if exists proc_watchers_insert on public.procurement_watchers;
create policy proc_watchers_insert on public.procurement_watchers
  for insert with check (
    exists (select 1 from public.procurement_requests r
            where r.id = procurement_request_id
              and r.submitter_id = (select auth.uid()))
  );

-- Being CC'd is what makes the request visible. Without this the notification
-- would arrive and the page would refuse to load — exactly the dead end the
-- payment side had until CC was fixed there.
drop policy if exists procurement_select on public.procurement_requests;
create policy procurement_select on public.procurement_requests
  for select using (
    submitter_id = (select auth.uid())
    or has_any_role(array['approver'::user_role, 'accounts'::user_role, 'admin'::user_role])
    or exists (
      select 1 from public.procurement_watchers w
      where w.procurement_request_id = id and w.user_id = (select auth.uid())
    )
  );
