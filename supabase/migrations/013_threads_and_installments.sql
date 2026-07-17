-- ============================================================================
-- Threads + installments refactor
--
-- Model change: payment_requests goes from "one row per submission" to
-- "one row per THREAD" (one PO/invoice negotiation for one vendor). Under
-- the thread, multiple request_installments — each installment is a
-- separate "release ₹X" ask that goes through its own approve → pay
-- lifecycle.
--
-- payment_requests today is empty, so we can drop the mixed thread/
-- installment fields cleanly and rebuild.
-- ============================================================================

-- Sanity: only run when the mixed table is empty.
do $$
begin
  if (select count(*) from payment_requests) > 0 then
    raise exception 'payment_requests is not empty; migration would truncate live data';
  end if;
end $$;

-- 1) Installments table -------------------------------------------------------
create table if not exists request_installments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references payment_requests(id) on delete cascade,
  installment_number int not null,
  requested_amount numeric(14, 2) not null check (requested_amount > 0),
  payment_due_date date not null,
  date_of_work_completion date,
  tentative_invoice_date date,
  purpose text,
  status request_status not null default 'pending_approval',
  submitted_by uuid not null references profiles(id),
  submitted_at timestamptz not null default now(),
  approver_id uuid references profiles(id),
  approved_at timestamptz,
  rejection_reason text,
  return_reason text,
  cancelled_at timestamptz,
  cancellation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (request_id, installment_number)
);
create index if not exists idx_installments_request on request_installments(request_id);
create index if not exists idx_installments_status on request_installments(status);

alter table request_installments enable row level security;

drop policy if exists "installments_select" on request_installments;
create policy "installments_select" on request_installments
  for select to authenticated
  using (
    exists (select 1 from payment_requests r where r.id = request_installments.request_id
      and (r.submitter_id = (select auth.uid())
           or has_any_role(array['approver', 'accounts', 'admin']::user_role[])))
  );

drop policy if exists "installments_insert" on request_installments;
create policy "installments_insert" on request_installments
  for insert to authenticated
  with check (
    submitted_by = (select auth.uid())
    and exists (select 1 from payment_requests r where r.id = request_installments.request_id
      and (r.submitter_id = (select auth.uid())
           or has_any_role(array['admin']::user_role[])))
  );

drop policy if exists "installments_update" on request_installments;
create policy "installments_update" on request_installments
  for update to authenticated
  using (
    exists (select 1 from payment_requests r where r.id = request_installments.request_id
      and (r.submitter_id = (select auth.uid())
           or has_any_role(array['approver', 'accounts', 'admin']::user_role[])))
  );

-- 2) payment_records now keys on the installment -----------------------------
alter table payment_records
  add column if not exists installment_id uuid references request_installments(id) on delete cascade;
create index if not exists idx_payment_records_installment on payment_records(installment_id);
-- One payment_record per installment (cash flow is 1:1 at the installment
-- level). Move the PK from request_id to installment_id so upserts on
-- installment_id do the right thing.
do $$
begin
  if exists (select 1 from pg_constraint where conname='payment_records_pkey' and conrelid='public.payment_records'::regclass) then
    -- Only re-key if the current PK is on request_id (i.e. still the old shape).
    if (
      select array_agg(a.attname order by a.attnum)::text
      from pg_constraint c
      join unnest(c.conkey) k(attnum) on true
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
      where c.conname='payment_records_pkey' and c.conrelid='public.payment_records'::regclass
    ) = '{request_id}' then
      alter table payment_records drop constraint payment_records_pkey;
      alter table payment_records alter column request_id drop not null;
      alter table payment_records alter column payment_mode drop not null;
      alter table payment_records alter column installment_id set not null;
      alter table payment_records add primary key (installment_id);
    end if;
  end if;
end $$;

-- 3) status_history rows point at the installment (thread-level rows keep
--    request_id nullable for future thread events)
alter table status_history
  add column if not exists installment_id uuid references request_installments(id) on delete cascade;
create index if not exists idx_status_history_installment on status_history(installment_id);

-- 4) Drop the policies + indexes that depend on soon-to-be-dropped columns.
drop policy if exists "requests_delete_own_draft" on payment_requests;
drop policy if exists "requests_update" on payment_requests;
drop index if exists idx_requests_status;
drop index if exists idx_requests_approver;
drop index if exists idx_requests_due_date;

-- balance_payable had a default expression referencing payment_amount /
-- previous_payments / total_bill_value, so drop it first.
alter table payment_requests drop column if exists balance_payable;
alter table payment_requests drop column if exists status;
alter table payment_requests drop column if exists approver_id;
alter table payment_requests drop column if exists approved_at;
alter table payment_requests drop column if exists rejection_reason;
alter table payment_requests drop column if exists return_reason;
alter table payment_requests drop column if exists submitted_at;
alter table payment_requests drop column if exists cancelled_at;
alter table payment_requests drop column if exists cancellation_reason;
alter table payment_requests drop column if exists payment_amount;
alter table payment_requests drop column if exists payment_percentage;
alter table payment_requests drop column if exists previous_payments;
alter table payment_requests drop column if exists payment_due_date;
alter table payment_requests drop column if exists date_of_work_completion;
alter table payment_requests drop column if exists tentative_invoice_date;
alter table payment_requests drop column if exists total_bill_value;

-- 5) Recreate the update policy without a status clause (submitter can
--    edit their own thread; approver/accounts/admin can edit any thread).
create policy "requests_update" on payment_requests
  for update to authenticated
  using (
    submitter_id = (select auth.uid())
    or has_any_role(array['approver', 'accounts', 'admin']::user_role[])
  )
  with check (
    submitter_id = (select auth.uid())
    or has_any_role(array['approver', 'accounts', 'admin']::user_role[])
  );

-- 6) Drop old coa_override_log columns that referenced request-level coa
-- (they were nuked earlier in migration 009; ensure clean).
-- (No action needed if already dropped.)
