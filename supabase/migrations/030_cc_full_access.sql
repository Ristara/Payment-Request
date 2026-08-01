-- Give a CC'd person the whole request, not half of it.
--
-- Every child table decides visibility by selecting from payment_requests and
-- letting that table's own policy answer — so line items, outlets, timeline,
-- payments, comments and attachments all followed requests_select, which has
-- always included watchers.
--
-- request_installments was the one that re-implemented the test inline:
--   submitter OR approver/accounts/admin — and no watcher clause.
--
-- Status lives on the installment, so a CC'd person saw the PO and the vendor
-- but not whether any of it had been approved or paid. Making it inherit like
-- its siblings fixes that and removes the duplicated rule that caused it.

drop policy if exists installments_select on public.request_installments;
create policy installments_select on public.request_installments
  for select to authenticated
  using (
    exists (
      select 1 from public.payment_requests r
      where r.id = request_installments.request_id
    )
  );

-- ---------------------------------------------------------------------------
-- A CC'd person can carry the request forward.
--
-- Being CC'd on a payment is how a second person picks it up — raising the
-- next installment against the same PO, or extending the PO itself. Both were
-- refused because the rules asked "did you raise this?" rather than "is this
-- yours to work on?".
--
-- Raising still needs the requester role: CC is about which request, not
-- about being allowed to ask for money.

create or replace function public.is_thread_participant(p_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.payment_requests r
    where r.id = p_request_id
      and (
        r.submitter_id = (select auth.uid())
        or exists (
          select 1 from public.request_watchers w
          where w.request_id = r.id and w.user_id = (select auth.uid())
        )
      )
  );
$$;

drop policy if exists installments_insert on public.request_installments;
create policy installments_insert on public.request_installments
  for insert to authenticated
  with check (
    submitted_by = (select auth.uid())
    and has_any_role(array['requester'::user_role, 'admin'::user_role])
    and status = any (array['draft', 'pending_approval']::request_status[])
    and (public.is_thread_participant(request_id) or has_any_role(array['admin'::user_role]))
  );

-- Extending the PO is the same question, so thread_is_editable moves from
-- "are you the submitter" to "are you on this thread". The rest of it — that
-- editing stops once an installment is approved — is unchanged.
create or replace function public.thread_is_editable(p_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    has_any_role(array['approver'::user_role, 'accounts'::user_role, 'admin'::user_role])
    or (
      public.is_thread_participant(p_request_id)
      and not exists (
        select 1 from public.request_installments i
        where i.request_id = p_request_id
          and i.status = any (
            array['approved', 'uploaded_in_bank', 'payment_processed',
                  'invoice_pending', 'closed']::request_status[]
          )
      )
    );
$$;
