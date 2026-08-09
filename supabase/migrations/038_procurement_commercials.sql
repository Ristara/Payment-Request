-- A procurement request carries the same commercial detail as a payment
-- request: how it will be paid, who from, against what document, itemised,
-- and split into instalments.
--
-- The difference is what it does NOT carry: no payment dates and no PO. Those
-- are precisely what does not exist yet — the dates are set when the payment
-- request is raised, and the PO is the thing being sought.
--
-- Nothing has been raised yet (verified: 0 rows), so estimated_amount is
-- dropped outright rather than left as a second, contradictory source of the
-- total. With line items, the value of a request is the sum of its lines.

alter table public.procurement_requests
  drop column if exists estimated_amount,
  add column if not exists payment_kind payment_kind not null default 'regular',
  -- Nullable, all three of them, and that is the point of this step: you often
  -- do not have a vendor or a quote number yet. Requiring them would block the
  -- exact case the feature exists for.
  add column if not exists vendor_id uuid references public.vendors(id) on delete restrict,
  add column if not exists document_type text,
  add column if not exists document_reference text;

create table if not exists public.procurement_line_items (
  id uuid primary key default gen_random_uuid(),
  procurement_request_id uuid not null
    references public.procurement_requests(id) on delete cascade,
  description text not null,
  quantity numeric(14,3) not null default 1 check (quantity > 0),
  rate numeric(14,2) not null default 0 check (rate >= 0),
  -- Stored, not derived. A line's amount is quantity × rate today, but a
  -- rounded or negotiated figure should survive rather than be recomputed.
  amount numeric(14,2) not null default 0 check (amount >= 0),
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists procurement_line_items_parent_idx
  on public.procurement_line_items (procurement_request_id, sort_order);

-- Far simpler than request_installments, deliberately. That table carries a
-- status, an approver, bank-file staging, TDS and a payment record, because it
-- IS the payment. This is a plan for one: how the total will be broken up.
create table if not exists public.procurement_installments (
  id uuid primary key default gen_random_uuid(),
  procurement_request_id uuid not null
    references public.procurement_requests(id) on delete cascade,
  installment_number int not null,
  amount numeric(14,2) not null check (amount >= 0),
  purpose text,
  created_at timestamptz not null default now(),
  unique (procurement_request_id, installment_number)
);

-- ---------------------------------------------------------------------------
-- RLS — children inherit the parent's visibility
-- ---------------------------------------------------------------------------
alter table public.procurement_line_items enable row level security;
alter table public.procurement_installments enable row level security;

-- Selecting from the parent is what enforces this: a row is visible exactly
-- when its request is, so the rules can never drift apart from each other.
drop policy if exists proc_lines_select on public.procurement_line_items;
create policy proc_lines_select on public.procurement_line_items
  for select using (
    exists (select 1 from public.procurement_requests r
            where r.id = procurement_request_id)
  );

drop policy if exists proc_lines_insert on public.procurement_line_items;
create policy proc_lines_insert on public.procurement_line_items
  for insert with check (
    exists (select 1 from public.procurement_requests r
            where r.id = procurement_request_id
              and r.submitter_id = (select auth.uid()))
  );

drop policy if exists proc_inst_select on public.procurement_installments;
create policy proc_inst_select on public.procurement_installments
  for select using (
    exists (select 1 from public.procurement_requests r
            where r.id = procurement_request_id)
  );

drop policy if exists proc_inst_insert on public.procurement_installments;
create policy proc_inst_insert on public.procurement_installments
  for insert with check (
    exists (select 1 from public.procurement_requests r
            where r.id = procurement_request_id
              and r.submitter_id = (select auth.uid()))
  );

-- No update or delete policies, matching the parent: edits go through a server
-- action with an explicit check, never a permissive policy.
