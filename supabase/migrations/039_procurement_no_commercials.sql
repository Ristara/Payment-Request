-- Undo 038. I inverted the instruction.
--
-- The list given — payment kind, vendor, document type and number, quantity,
-- rate, amount, instalment details, payment details, dates — was the list of
-- what is NOT wanted on a procurement request. I read it as the list of what
-- to add and built exactly the wrong thing.
--
-- What belongs here is everything ELSE the payment form asks: the title, the
-- purpose, the branch, the expense type, new store vs existing outlet,
-- supporting documents and CC. None of the commercial detail: at this point
-- there is no vendor, no quote and no price — that is the whole reason the
-- request exists.
--
-- Dropped outright rather than left unused. Nothing has been raised (verified
-- 0 rows), and a table nobody writes to is a trap for whoever reads the schema
-- next.
drop table if exists public.procurement_line_items;
drop table if exists public.procurement_installments;

alter table public.procurement_requests
  drop column if exists payment_kind,
  drop column if exists vendor_id,
  drop column if exists document_type,
  drop column if exists document_reference;
