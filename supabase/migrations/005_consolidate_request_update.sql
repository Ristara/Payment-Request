-- ============================================================================
-- Consolidate the two overlapping UPDATE policies on payment_requests into
-- one, matching either "own draft" OR "staff role". Same semantics, one policy
-- pass per row instead of two.
-- ============================================================================

drop policy if exists "requests_update_own_draft" on payment_requests;
drop policy if exists "requests_update_staff" on payment_requests;

create policy "requests_update" on payment_requests
  for update to authenticated
  using (
    (submitter_id = (select auth.uid()) and status = 'draft')
    or has_any_role(array['approver', 'accounts', 'admin']::user_role[])
  )
  with check (
    (submitter_id = (select auth.uid()) and status = 'draft')
    or has_any_role(array['approver', 'accounts', 'admin']::user_role[])
  );
