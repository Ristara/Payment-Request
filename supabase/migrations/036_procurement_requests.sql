-- Procurement requests — the step before a payment request.
--
-- Until now the app started with a PO already in hand. This is where that PO
-- comes from: someone needs a repair or a purchase, an approver sanctions the
-- need, procurement sources a vendor and records the PO, and a payment request
-- is raised from it later.
--
-- A SEPARATE table, not a type flag on payment_requests. The two lifecycles
-- share almost nothing — a payment goes approved → bank file → paid → invoice
-- → closed, a procurement request goes approved → sourced → PO obtained. One
-- status column covering both would leave most values meaningless for any
-- given row, and every tab and filter would have to know which kind it was
-- looking at.
--
-- Raising a payment request directly is UNCHANGED. This is a second door, not
-- a new hallway everyone must walk down.

do $$ begin
  create type procurement_status as enum (
    'pending_approval', 'approved', 'po_obtained', 'closed', 'rejected', 'cancelled'
  );
exception when duplicate_object then null;
end $$;

create sequence if not exists procurement_number_seq start 1;

-- PRQ- rather than PR-, which is already the payment prefix. Two identifiers
-- one letter apart, in a company that says both aloud, is a mis-read waiting
-- to happen.
create or replace function public.next_procurement_number()
returns text
language sql
volatile
as $$
  select 'PRQ-' || to_char(now(), 'YYYY') || '-' ||
         lpad(nextval('procurement_number_seq')::text, 5, '0');
$$;

create table if not exists public.procurement_requests (
  id uuid primary key default gen_random_uuid(),
  request_number text not null unique,
  submitter_id uuid not null references public.profiles(id) on delete restrict,
  title text not null,
  description text not null,
  -- One outlet. A fridge breaks in one place, and a single outlet keeps the
  -- branch check a plain column comparison rather than a join table.
  outlet_id uuid not null references public.outlets(id) on delete restrict,
  expense_type expense_type not null default 'capex',
  -- Not binding. It is what lets an approver tell a 2,000 rupee decision from
  -- a 2,00,000 one without ringing anybody.
  estimated_amount numeric(14,2),
  priority text not null default 'normal' check (priority in ('normal', 'urgent')),
  status procurement_status not null default 'pending_approval',

  approver_id uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  rejection_reason text,

  -- Filled by procurement once a vendor is found and a PO exists. This is the
  -- handover point to the payment side.
  procured_by uuid references public.profiles(id) on delete set null,
  po_reference text,
  po_vendor_id uuid references public.vendors(id) on delete set null,
  po_obtained_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists procurement_requests_status_idx
  on public.procurement_requests (status, created_at desc);
create index if not exists procurement_requests_submitter_idx
  on public.procurement_requests (submitter_id);
create index if not exists procurement_requests_outlet_idx
  on public.procurement_requests (outlet_id);

-- Notifications reach across to the new table. request_id stays as it is, so
-- nothing already written has to change; a row carries one or the other.
alter table public.notifications
  add column if not exists procurement_request_id uuid
    references public.procurement_requests(id) on delete cascade;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.procurement_requests enable row level security;

-- Visible to the person who raised it, and to everyone who acts on it.
-- Procurement is here because the whole point of the role is seeing this
-- queue; approvers and accounts already see every payment request, and hiding
-- the upstream request from them would leave them reading half a story.
drop policy if exists procurement_select on public.procurement_requests;
create policy procurement_select on public.procurement_requests
  for select using (
    submitter_id = (select auth.uid())
    or has_any_role(array[
      'approver'::user_role, 'accounts'::user_role,
      'admin'::user_role, 'procurement'::user_role
    ])
  );

-- Raising follows exactly the same rule as a payment request: the requester
-- role, and a branch you are allowed to raise for. A second door into the same
-- building should not have a weaker lock.
drop policy if exists procurement_insert on public.procurement_requests;
create policy procurement_insert on public.procurement_requests
  for insert with check (
    submitter_id = (select auth.uid())
    and has_any_role(array['requester'::user_role, 'admin'::user_role])
    and may_raise_for_outlet(outlet_id)
  );

-- No UPDATE or DELETE policy, deliberately.
--
-- Every state change — approve, reject, record the PO, cancel — runs through a
-- server action under the service-role client with requireRole in front of it,
-- the same way installment transitions already work. A permissive UPDATE
-- policy here could not express "an approver may set status but not
-- estimated_amount", and migration 026 exists because that gap was already
-- exploited once.
