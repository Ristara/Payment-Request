-- 1. Put back a payment the app lost.
--
-- PR-2026-00241 instalment #1. Bheemashankar recorded ₹5,09,600 at 18:17 IST
-- on 10 Aug 2026. Migration 044 had restructured payment_records about a
-- minute earlier, and the build that matched it had not finished deploying —
-- so the old code wrote against a constraint that no longer existed and the
-- insert failed. The status had already been moved by then, which is why the
-- instalment read "Invoice pending" with no payment behind it.
--
-- Rebuilt from the status_history line the transition wrote, which recorded
-- the amount, the UTR and who did it. The payment DATE is inferred from the
-- UTR: every one of the 8 surviving records has the form FCM-YYMMDD…, and
-- FCM-260629NP9NJY gives 29 Jun 2026 — which is also this instalment's due
-- date. paying_bank_account is left null because nothing recorded it; that is
-- the one field Bheemashankar needs to fill back in.

insert into payment_records
  (installment_id, request_id, payment_date, paid_amount, utr_reference, recorded_by)
select i.id, i.request_id, date '2026-06-29', 509600.00, 'FCM-260629NP9NJY',
       (select h.actor_id from status_history h
         where h.installment_id = i.id and h.to_status = 'invoice_pending'
         order by h.created_at desc limit 1)
  from request_installments i
 where i.id = '61096e8e-393f-4651-874f-ac4e53df5a78'
   and not exists (select 1 from payment_records p where p.installment_id = i.id);

-- 2. Add the uniqueness the code already believes in.
--
-- markInstallmentPaid catches "payment_records_installment_utr_uniq" and turns
-- it into "That UTR is already recorded against this installment." No such
-- constraint was ever created, so that branch could never fire and the same
-- UTR could be banked twice against one instalment — which is exactly what a
-- double-click on a slow connection produces.
create unique index if not exists payment_records_installment_utr_uniq
  on public.payment_records (installment_id, utr_reference);
