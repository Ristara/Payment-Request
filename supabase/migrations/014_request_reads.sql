-- Per-user read markers for thread discussions — powers WhatsApp-style
-- unread badges on the request lists. One row per (thread, user); bumped
-- to now() whenever the user opens the thread detail page.

create table if not exists request_reads (
  request_id uuid not null references payment_requests(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (request_id, user_id)
);

alter table request_reads enable row level security;

drop policy if exists "reads_own" on request_reads;
create policy "reads_own" on request_reads
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
