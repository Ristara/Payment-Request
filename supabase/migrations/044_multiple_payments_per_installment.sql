-- More than one payment against a single instalment.
--
-- payment_records had installment_id as its PRIMARY KEY, so an instalment
-- could hold exactly one payment. That is wrong in the ordinary case the
-- owner hit: ₹1,000 paid against a ₹50,00,000 instalment, the balance to
-- follow. Recording the second payment would not have failed — markInstallmentPaid
-- upserts on installment_id, so it would have OVERWRITTEN the first, silently
-- discarding a real UTR for money that had left the bank.
--
-- A surrogate key replaces it. installment_id keeps an index because every
-- read groups by it, but it is no longer unique.

alter table public.payment_records
  add column if not exists id uuid not null default gen_random_uuid();

do $$ begin
  alter table public.payment_records drop constraint payment_records_pkey;
exception when undefined_object then null;
end $$;

do $$ begin
  alter table public.payment_records add constraint payment_records_pkey primary key (id);
exception when duplicate_table then null;
end $$;

create index if not exists payment_records_installment_idx
  on public.payment_records (installment_id, payment_date);

-- The same UTR twice against one instalment is a double-entry, not a second
-- payment. Cheap to enforce here and impossible to argue with later.
create unique index if not exists payment_records_installment_utr_uniq
  on public.payment_records (installment_id, utr_reference);

comment on table public.payment_records is
  'One row per PAYMENT, not per instalment. An instalment settled in parts has several. Always SUM by installment_id — never take the first row.';
