-- Integrity fixes on the bank-payment path.

-- ---------------------------------------------------------------------------
-- 1. The queue marker must not outlive the approval it belongs to.
--
-- queued_for_upload_at was only ever cleared by the three code paths that
-- remembered to. Anything else that moved an installment out of 'approved' —
-- an approver pulling their approval back, a rejection, an edit-and-resubmit —
-- left the marker set. The moment the installment was approved again it was
-- back in the bank file, at whatever amount it now carried, without anyone
-- having queued it.
--
-- TDS gets the same treatment, but only when the installment goes BACKWARDS
-- to a pre-approval state: what was withheld is part of the record once a
-- payment has been sent, so uploaded_in_bank and everything after it keep it.

create or replace function public.clear_queue_marker_off_approved()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from 'approved'::request_status then
    new.queued_for_upload_at := null;
    new.queued_by := null;
  end if;

  if new.status = any (array['draft', 'pending_approval', 'clarification_required',
                             'rejected', 'returned_for_correction',
                             'cancelled']::request_status[]) then
    new.tds_amount := 0;
    new.tds_percent := null;
    new.tds_section := null;
  end if;

  return new;
end;
$$;

drop trigger if exists installments_clear_queue_marker on public.request_installments;
create trigger installments_clear_queue_marker
  before update of status on public.request_installments
  for each row
  execute function public.clear_queue_marker_off_approved();

-- Anything already stranded by the old behaviour.
update public.request_installments
   set queued_for_upload_at = null, queued_by = null
 where status <> 'approved' and queued_for_upload_at is not null;

-- ---------------------------------------------------------------------------
-- 2. Record which account a batch actually paid.
--
-- Vendor bank details can be corrected at any time, so the vendor row answers
-- "where would we pay them now", not "where did that batch go". For a
-- payment that has already left, those are different questions.

alter table public.payment_records
  add column if not exists paid_to_account text,
  add column if not exists paid_to_ifsc text;

comment on column public.payment_records.paid_to_account is
  'Beneficiary account as written into the bank file. The vendor record may since have changed.';
