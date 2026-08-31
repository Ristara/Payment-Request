-- Pivot layouts a person has saved and named.
--
-- Private to whoever made them. A saved report is a working note — "the one I
-- check on Mondays" — not a company artefact, and a shared list would fill up
-- with other people's half-finished views. Sharing can be added later if
-- anyone asks; un-sharing what was public by default cannot.
--
-- The layout is jsonb rather than columns because it IS a shape: which fields
-- are on rows, on columns, filtering, and which values each filter excludes.
-- Columns would need a migration every time the pivot learns a new trick.

create table if not exists public.saved_reports (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  config jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Saving under a name you already used overwrites it, which needs this.
  unique (owner_id, name)
);

create index if not exists saved_reports_owner_idx on public.saved_reports (owner_id, name);

alter table public.saved_reports enable row level security;

-- Yours and only yours, for every operation. No admin override: an admin has
-- no business reading someone's private report list, and nothing depends on
-- it that would need rescuing.
drop policy if exists saved_reports_own on public.saved_reports;
create policy saved_reports_own on public.saved_reports
  for all using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
