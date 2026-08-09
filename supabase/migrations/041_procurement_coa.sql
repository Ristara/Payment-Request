-- Category · Sub category · Account on a procurement request.
--
-- Three columns, not one, because a choice can legitimately stop short of the
-- leaf: the payment form already allows charging a whole sub category when it
-- has no accounts under it. Storing only coa_account_id would make that case
-- unrepresentable, and storing only text would lose the link to the account.
--
-- The column names are off by one from the labels, matching the rest of the
-- schema and src/lib/coa-labels.ts: `coa` is shown as Category and
-- `coa_category` as Sub category. Renaming the originals was rejected long ago
-- — they are referenced by RLS, the importer, reports and every migration
-- since 002 — so the new columns follow the existing convention rather than
-- inventing a second one.
alter table public.procurement_requests
  add column if not exists coa text,
  add column if not exists coa_category text,
  add column if not exists coa_account_id uuid
    references public.coa_accounts(id) on delete restrict;

create index if not exists procurement_requests_coa_account_idx
  on public.procurement_requests (coa_account_id);
