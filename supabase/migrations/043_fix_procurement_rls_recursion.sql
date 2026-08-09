-- Fix: the CC policy made procurement_requests invisible to everyone.
--
-- procurement_requests' SELECT policy asked procurement_watchers whether you
-- were CC'd; procurement_watchers' policy asked procurement_requests whether
-- you could see the parent. Each waits on the other and the whole predicate
-- collapses to false — the symptom was not "CC does not work" but "nobody can
-- see anything, including their own requests".
--
-- Same shape as is_thread_participant on the payment side, and the same fix:
-- a SECURITY DEFINER helper runs without RLS, so the loop cannot form.

create or replace function public.is_procurement_watcher(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.procurement_watchers w
    where w.procurement_request_id = p_id and w.user_id = (select auth.uid())
  );
$$;

-- Used by the CHILD tables so they never have to query the parent from inside
-- a policy, which is the other half of the loop.
create or replace function public.can_view_procurement(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.procurement_requests r
    where r.id = p_id
      and (
        r.submitter_id = (select auth.uid())
        or has_any_role(array['approver'::user_role, 'accounts'::user_role, 'admin'::user_role])
        or exists (
          select 1 from public.procurement_watchers w
          where w.procurement_request_id = r.id and w.user_id = (select auth.uid())
        )
      )
  );
$$;

drop policy if exists procurement_select on public.procurement_requests;
create policy procurement_select on public.procurement_requests
  for select using (
    submitter_id = (select auth.uid())
    or has_any_role(array['approver'::user_role, 'accounts'::user_role, 'admin'::user_role])
    or public.is_procurement_watcher(id)
  );

drop policy if exists proc_watchers_select on public.procurement_watchers;
create policy proc_watchers_select on public.procurement_watchers
  for select using (public.can_view_procurement(procurement_request_id));

-- Attachments hung off procurement were invisible: the existing policy only
-- considers request_id, comment_id and vendor_id, and a procurement
-- attachment has all three null.
drop policy if exists attachments_select on public.attachments;
create policy attachments_select on public.attachments
  for select using (
    (request_id is not null and exists (
      select 1 from public.payment_requests r where r.id = attachments.request_id))
    or (comment_id is not null and exists (
      select 1 from public.comments c where c.id = attachments.comment_id))
    or (vendor_id is not null and exists (
      select 1 from public.vendors v where v.id = attachments.vendor_id))
    or (procurement_request_id is not null
        and public.can_view_procurement(procurement_request_id))
  );
