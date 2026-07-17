-- Consolidate PO/invoice fields into a single document-type + reference pair.
--
-- Old fields (po_number, po_not_applicable_reason, invoice_reference) were
-- three columns tracking the same concept. Payment_requests is currently
-- empty so we can drop them cleanly and replace with:
--   document_type      -- what kind of doc backs this request
--   document_reference -- the number/id of that doc (only when applicable)

do $$ begin
  create type document_type as enum ('po', 'invoice', 'no_invoice', 'invoice_pending');
exception when duplicate_object then null; end $$;

alter table payment_requests
  add column if not exists document_type document_type,
  add column if not exists document_reference text;

-- Reference is required only when the doc actually has a number.
alter table payment_requests
  drop constraint if exists document_reference_required;
alter table payment_requests
  add constraint document_reference_required check (
    document_type is null
    or document_type in ('no_invoice', 'invoice_pending')
    or (document_reference is not null and length(trim(document_reference)) > 0)
  );

alter table payment_requests
  drop column if exists po_number,
  drop column if exists po_not_applicable_reason,
  drop column if exists invoice_reference;
