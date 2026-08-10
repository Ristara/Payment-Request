-- A managed list of TDS sections, so Accounts pick instead of typing.
--
-- tds_section has been free text. Two installments carry "TDS on Commission"
-- and "Professional Fee" — neither is a section, both are descriptions, and
-- nothing ties either to a rate. tds_percent is derived from the amount, which
-- is why one of them reads 8.47%: an artifact of division, not a rate anybody
-- chose.
--
-- Seeded with section CODES AND NAMES ONLY, rates left null for an admin to
-- fill in. The codes are stable; the rates change with each Finance Act, and
-- putting a number I have not verified into a live tax field is not a
-- convenience, it is a liability.

create table if not exists public.tds_sections (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  -- Nullable on purpose: an admin sets it. A section with no rate can still be
  -- chosen; the amount is typed either way.
  rate numeric(5,2) check (rate is null or (rate >= 0 and rate <= 100)),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tds_sections_active_idx on public.tds_sections (is_active, code);

alter table public.tds_sections enable row level security;

-- Readable by everyone signed in — Accounts need the list, and a section code
-- is not sensitive.
drop policy if exists tds_sections_read on public.tds_sections;
create policy tds_sections_read on public.tds_sections
  for select using ((select auth.uid()) is not null);

-- Only admins change the list, and only through the service-role client after
-- a TypeScript check, matching how outlets and the chart of accounts work.
drop policy if exists tds_sections_admin on public.tds_sections;
create policy tds_sections_admin on public.tds_sections
  for all using (has_role('admin'::user_role)) with check (has_role('admin'::user_role));

insert into public.tds_sections (code, name) values
  ('194C', 'Payment to contractors'),
  ('194H', 'Commission or brokerage'),
  ('194I(a)', 'Rent — plant and machinery'),
  ('194I(b)', 'Rent — land, building, furniture'),
  ('194J', 'Professional or technical services'),
  ('194Q', 'Purchase of goods'),
  ('194A', 'Interest other than on securities')
on conflict (code) do nothing;

-- The chosen section is snapshotted onto the installment as well as linked.
-- A rate or a name that changes next year must not rewrite what was deducted
-- last year.
alter table public.request_installments
  add column if not exists tds_section_id uuid references public.tds_sections(id) on delete set null;
