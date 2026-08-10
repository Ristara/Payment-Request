-- Correct instalments that a bug left looking part-paid.
--
-- "Still to pay" was requested_amount minus payments, ignoring TDS. On a
-- ₹1,18,000 instalment with ₹10,000 of TDS, the ₹1,08,000 that reached the
-- vendor settled it — but the maths reported ₹10,000 outstanding for ever, so
-- recordInstallmentPaid took the part-payment branch and never advanced the
-- status. The instalment stayed in the Accounts queue with the money already
-- gone.
--
-- The code is fixed; this repairs the rows it already stranded. Deliberately
-- narrow: only rows that carry TDS, have at least one real payment, are fully
-- settled once TDS is netted off, and are still sitting pre-payment. Anything
-- with a genuine balance is untouched.
--
-- invoice_pending, not payment_processed: none of these has an invoice
-- attached, which is exactly the distinction the action itself draws.

with stranded as (
  select i.id, i.request_id, i.status,
         (select p.recorded_by
            from payment_records p
           where p.installment_id = i.id and p.recorded_by is not null
           order by p.created_at limit 1) as actor
    from request_installments i
   where coalesce(i.tds_amount, 0) > 0
     and i.status in ('approved', 'uploaded_in_bank')
     and exists (select 1 from payment_records p where p.installment_id = i.id)
     and i.requested_amount - coalesce(i.tds_amount, 0)
         - coalesce((select sum(p.paid_amount) from payment_records p
                      where p.installment_id = i.id), 0) <= 0.5
     and not exists (
       select 1 from attachments a
        where a.request_id = i.request_id and a.stage = 'invoice'
          and a.storage_path like '%/installments/' || i.id || '/%')
),
logged as (
  insert into status_history (request_id, installment_id, from_status, to_status, actor_id, comment)
  select s.request_id, s.id, s.status::request_status, 'invoice_pending'::request_status, s.actor,
         'Corrected: instalment was already settled once TDS was netted off'
    from stranded s
   where s.actor is not null
  returning 1
)
update request_installments i
   set status = 'invoice_pending'
  from stranded s
 where i.id = s.id;
