-- Close the write holes that let a submitter approve and pay themselves.
--
-- The app itself does almost all of its writes through the service-role
-- client, which bypasses RLS entirely — so these policies were never the thing
-- keeping the workflow honest, and tightening them changes no legitimate
-- flow. What they were doing was defining what someone can do by talking to
-- PostgREST directly with their own session token and the public key, which is
-- something any signed-in user can do from a browser console.
--
-- Chained together the old policies allowed: create a vendor that is already
-- approved and carries your own bank account -> raise a request against it ->
-- approve your own installment -> it appears in the next Kotak bank file.
-- Each step below removes one link.

-- A thread is still the submitter's to shape until one of its installments
-- has been approved; after that the numbers behind an approved amount are
-- fixed. Staff are exempt. SECURITY DEFINER so the policy can read
-- request_installments without needing its own select policy to match.
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
      exists (
        select 1 from public.payment_requests r
        where r.id = p_request_id and r.submitter_id = (select auth.uid())
      )
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

-- ---------------------------------------------------------------------------
-- 1. A submitter must not be able to approve their own installment.
--
-- The old policy had a USING clause and no WITH CHECK, so Postgres reused
-- USING as the check: "the row is still mine" was the only test, and status
-- was never mentioned. Setting status = 'approved' passed.

drop policy if exists installments_update on public.request_installments;
create policy installments_update on public.request_installments
  for update to authenticated
  using (
    exists (
      select 1 from public.payment_requests r
      where r.id = request_installments.request_id
        and (
          has_any_role(array['approver'::user_role, 'accounts'::user_role, 'admin'::user_role])
          or (
            r.submitter_id = (select auth.uid())
            -- Rows the submitter legitimately still owns.
            and request_installments.status = any (
              array['draft', 'pending_approval', 'clarification_required',
                    'rejected', 'returned_for_correction']::request_status[]
            )
          )
        )
    )
  )
  with check (
    exists (
      select 1 from public.payment_requests r
      where r.id = request_installments.request_id
        and (
          has_any_role(array['approver'::user_role, 'accounts'::user_role, 'admin'::user_role])
          or (
            r.submitter_id = (select auth.uid())
            -- ...and the states they may leave it in. 'approved' and
            -- everything downstream of it are absent on purpose.
            and request_installments.status = any (
              array['draft', 'pending_approval', 'clarification_required',
                    'cancelled']::request_status[]
            )
          )
        )
    )
  );

-- An installment must also not be born approved.
drop policy if exists installments_insert on public.request_installments;
create policy installments_insert on public.request_installments
  for insert to authenticated
  with check (
    submitted_by = (select auth.uid())
    and has_any_role(array['requester'::user_role, 'admin'::user_role])
    and status = any (array['draft', 'pending_approval']::request_status[])
    and exists (
      select 1 from public.payment_requests r
      where r.id = request_installments.request_id
        and (r.submitter_id = (select auth.uid()) or has_any_role(array['admin'::user_role]))
    )
  );

-- ---------------------------------------------------------------------------
-- 2. A vendor must not be able to be born approved.
--
-- vendors_insert checked only submitted_by, so the status column was free —
-- anyone could insert a vendor already marked approved, carrying whatever
-- bank account they liked, skipping the whole verification step.

drop policy if exists vendors_insert on public.vendors;
create policy vendors_insert on public.vendors
  for insert to authenticated
  with check (
    submitted_by = (select auth.uid())
    and status = 'pending'::vendor_status
  );

-- ---------------------------------------------------------------------------
-- 3. A thread must stop being editable once money is moving.
--
-- The submitter could change vendor_id at any point in the lifecycle —
-- including after approval — which points an approved amount at a different
-- payee.

-- thread_is_editable() is SECURITY DEFINER on purpose: a policy on
-- payment_requests that reads request_installments directly recurses, because
-- the installment policies read payment_requests straight back.
drop policy if exists requests_update on public.payment_requests;
create policy requests_update on public.payment_requests
  for update to authenticated
  using (public.thread_is_editable(id))
  with check (public.thread_is_editable(id));

-- The same rule for what an approved amount is made of: line items and the
-- outlets it's booked against.
drop policy if exists line_items_insert on public.request_line_items;
drop policy if exists line_items_update on public.request_line_items;
drop policy if exists line_items_delete on public.request_line_items;
drop policy if exists req_outlets_insert on public.request_outlets;
drop policy if exists req_outlets_update on public.request_outlets;
drop policy if exists req_outlets_delete on public.request_outlets;

create policy line_items_insert on public.request_line_items
  for insert to authenticated
  with check (public.thread_is_editable(request_id));
create policy line_items_update on public.request_line_items
  for update to authenticated
  using (public.thread_is_editable(request_id))
  with check (public.thread_is_editable(request_id));
create policy line_items_delete on public.request_line_items
  for delete to authenticated
  using (public.thread_is_editable(request_id));

create policy req_outlets_insert on public.request_outlets
  for insert to authenticated
  with check (public.thread_is_editable(request_id));
create policy req_outlets_update on public.request_outlets
  for update to authenticated
  using (public.thread_is_editable(request_id))
  with check (public.thread_is_editable(request_id));
create policy req_outlets_delete on public.request_outlets
  for delete to authenticated
  using (public.thread_is_editable(request_id));

-- ---------------------------------------------------------------------------
-- 4. Nobody may switch their own account back on.
--
-- profiles_update_own was column-unrestricted, so a deactivated user could
-- set is_active back to true on their own row and walk straight back in —
-- which would have made the whole deactivation feature decorative. RLS can't
-- express "any column except this one", so this is a column-level grant.

revoke update on public.profiles from authenticated;
grant update (full_name, phone) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Invoices and bank documents must not be readable by everyone.
--
-- Both storage policies scoped on bucket_id alone, which for a two-bucket
-- system is the same as "true": every signed-in account could list and
-- download every invoice, PO and vendor cancelled cheque in the system.
--
-- The app serves these through signed URLs minted with the service-role
-- client, so it is unaffected.

drop policy if exists attachments_read_authenticated on storage.objects;
create policy attachments_read_authenticated on storage.objects
  for select to authenticated
  using (
    (
      bucket_id = 'request-attachments'
      and exists (
        select 1 from public.payment_requests r
        where r.id::text = split_part(objects.name, '/', 1)
          and (
            r.submitter_id = (select auth.uid())
            or has_any_role(array['approver'::user_role, 'accounts'::user_role, 'admin'::user_role])
            or exists (
              select 1 from public.request_watchers w
              where w.request_id = r.id and w.user_id = (select auth.uid())
            )
          )
      )
    )
    or (
      bucket_id = 'vendor-docs'
      and has_any_role(array['accounts'::user_role, 'admin'::user_role])
    )
  );

drop policy if exists attachments_upload_authenticated on storage.objects;
create policy attachments_upload_authenticated on storage.objects
  for insert to authenticated
  with check (
    (
      bucket_id = 'request-attachments'
      and exists (
        select 1 from public.payment_requests r
        where r.id::text = split_part(objects.name, '/', 1)
          and (
            r.submitter_id = (select auth.uid())
            or has_any_role(array['approver'::user_role, 'accounts'::user_role, 'admin'::user_role])
          )
      )
    )
    or (
      bucket_id = 'vendor-docs'
      and has_any_role(array['requester'::user_role, 'accounts'::user_role, 'admin'::user_role])
    )
  );
