-- CC list per thread: people looped in for visibility. Watchers can VIEW
-- the thread (and its children — every child table's select policy already
-- delegates to "can you see the parent payment_requests row").

create table if not exists request_watchers (
  request_id uuid not null references payment_requests(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  added_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (request_id, user_id)
);

alter table request_watchers enable row level security;

-- Users see their own watcher rows (powers "CC'd to you" lists); staff see
-- all. IMPORTANT: this policy must NOT reference payment_requests —
-- requests_select below references request_watchers, and mutual references
-- make Postgres raise "infinite recursion detected in policy".
drop policy if exists "watchers_select" on request_watchers;
create policy "watchers_select" on request_watchers
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or has_any_role(array['approver', 'accounts', 'admin']::user_role[])
  );
-- Inserts happen via the service-role client from createThread; no
-- authenticated insert policy needed.

-- Extend thread visibility: submitter, staff, or CC'd watcher.
drop policy if exists "requests_select" on payment_requests;
create policy "requests_select" on payment_requests
  for select to authenticated
  using (
    submitter_id = (select auth.uid())
    or has_any_role(array['approver', 'accounts', 'admin']::user_role[])
    or exists (
      select 1 from request_watchers w
      where w.request_id = payment_requests.id
        and w.user_id = (select auth.uid())
    )
  );
