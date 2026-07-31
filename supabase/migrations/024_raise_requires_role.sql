-- Raising a payment request needs a role.
--
-- Both insert policies only ever asked "is this row yours?", never "are you
-- allowed to create one?". A user whose roles had all been removed could still
-- submit payment requests, because being signed in was the entire test.
--
-- has_any_role() is already SECURITY DEFINER and used by the select/update
-- policies on these same tables, so this only adds the missing half.

drop policy if exists requests_insert on public.payment_requests;
create policy requests_insert on public.payment_requests
  for insert to authenticated
  with check (
    submitter_id = (select auth.uid())
    and has_any_role(array['requester'::user_role, 'admin'::user_role])
  );

-- Follow-up installments are raised by the same person under the same rule.
-- The thread-ownership half is kept exactly as it was.
drop policy if exists installments_insert on public.request_installments;
create policy installments_insert on public.request_installments
  for insert to authenticated
  with check (
    submitted_by = (select auth.uid())
    and has_any_role(array['requester'::user_role, 'admin'::user_role])
    and exists (
      select 1 from public.payment_requests r
      where r.id = request_installments.request_id
        and (r.submitter_id = (select auth.uid()) or has_any_role(array['admin'::user_role]))
    )
  );
