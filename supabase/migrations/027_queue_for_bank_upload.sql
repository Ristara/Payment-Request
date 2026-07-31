-- Let Accounts choose what goes into the next bank file.
--
-- Until now the Kotak file swept up every approved installment that had
-- payable vendor details. That gave Accounts no say in what left the bank on
-- any given run — approving a payment and paying it were effectively the same
-- action, just separated in time.
--
-- Deliberately NOT a new status. From everyone else's point of view the
-- installment is still 'approved' — the requester, the reports, the assistant
-- and the badges should not learn a new word for it, and the workflow's
-- state machine, its RLS policies and its allowed-transition map all key off
-- that status. This is Accounts' own staging marker sitting on top.

alter table public.request_installments
  add column if not exists queued_for_upload_at timestamptz,
  add column if not exists queued_by uuid references auth.users (id) on delete set null;

-- The bank file reads exactly this set, so keep it cheap.
create index if not exists request_installments_queued_idx
  on public.request_installments (queued_for_upload_at)
  where queued_for_upload_at is not null;

comment on column public.request_installments.queued_for_upload_at is
  'Set by Accounts to include this approved installment in the next bank file. Cleared when it moves to uploaded_in_bank, or when Accounts take it back out.';
