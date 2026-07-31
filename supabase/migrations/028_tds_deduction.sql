-- TDS withheld by Accounts before the payment goes to the bank.
--
-- The requested amount is what the vendor invoiced and what was approved;
-- it must not change, because that is the figure the approver agreed to and
-- the number the PO balance is tracked against. TDS is a separate deduction
-- applied on the way out, so the vendor receives less than was approved and
-- the difference is remitted to the tax authority.
--
-- Stored on the installment rather than payment_records because it is decided
-- when the payment is queued, which is before any payment record exists.

alter table public.request_installments
  add column if not exists tds_amount numeric(14, 2) not null default 0,
  add column if not exists tds_percent numeric(5, 2),
  add column if not exists tds_section text;

-- Withholding more than the invoice is always a mistake, and a negative
-- deduction would quietly pay the vendor extra.
alter table public.request_installments
  drop constraint if exists request_installments_tds_within_amount;
alter table public.request_installments
  add constraint request_installments_tds_within_amount
  check (tds_amount >= 0 and tds_amount <= requested_amount);

comment on column public.request_installments.tds_amount is
  'TDS withheld by Accounts. The bank is paid requested_amount - tds_amount; requested_amount stays as approved.';

-- What actually leaves the bank, so the file and the UI can't drift apart.
create or replace function public.installment_net_payable(
  p_requested numeric,
  p_tds numeric
) returns numeric
language sql
immutable
as $$
  select round(greatest(p_requested - coalesce(p_tds, 0), 0), 2);
$$;
