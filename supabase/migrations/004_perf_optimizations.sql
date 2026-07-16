-- ============================================================================
-- Phase 1 performance optimizations
--
-- Three classes of fix per Supabase performance advisor:
--   1. Wrap `auth.uid()` in `(select ...)` so Postgres caches the result once
--      per query instead of re-evaluating per row.
--   2. Drop duplicate permissive SELECT policies — where admins were covered
--      by both a generic read policy and an admin-all policy, keep only the
--      broader one.
--   3. Add covering indexes on foreign keys that lacked them.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Rewrite auth.uid() calls to be cached per query
-- ---------------------------------------------------------------------------

-- profiles
drop policy if exists "profiles_update_own" on profiles;
create policy "profiles_update_own" on profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- vendors
drop policy if exists "vendors_select" on vendors;
create policy "vendors_select" on vendors
  for select to authenticated
  using (
    status = 'approved'
    or submitted_by = (select auth.uid())
    or has_any_role(array['approver', 'accounts', 'admin']::user_role[])
  );

drop policy if exists "vendors_insert" on vendors;
create policy "vendors_insert" on vendors
  for insert to authenticated
  with check (submitted_by = (select auth.uid()));

-- payment_requests
drop policy if exists "requests_select" on payment_requests;
create policy "requests_select" on payment_requests
  for select to authenticated
  using (
    submitter_id = (select auth.uid())
    or has_any_role(array['approver', 'accounts', 'admin']::user_role[])
  );

drop policy if exists "requests_insert" on payment_requests;
create policy "requests_insert" on payment_requests
  for insert to authenticated
  with check (submitter_id = (select auth.uid()));

drop policy if exists "requests_update_own_draft" on payment_requests;
create policy "requests_update_own_draft" on payment_requests
  for update to authenticated
  using (submitter_id = (select auth.uid()) and status = 'draft')
  with check (submitter_id = (select auth.uid()));

drop policy if exists "requests_delete_own_draft" on payment_requests;
create policy "requests_delete_own_draft" on payment_requests
  for delete to authenticated
  using (submitter_id = (select auth.uid()) and status = 'draft');

-- request_outlets
drop policy if exists "req_outlets_write" on request_outlets;
create policy "req_outlets_write" on request_outlets
  for all to authenticated
  using (
    exists (select 1 from payment_requests r where r.id = request_outlets.request_id
      and (r.submitter_id = (select auth.uid())
           or has_any_role(array['approver', 'accounts', 'admin']::user_role[])))
  )
  with check (
    exists (select 1 from payment_requests r where r.id = request_outlets.request_id
      and (r.submitter_id = (select auth.uid())
           or has_any_role(array['approver', 'accounts', 'admin']::user_role[])))
  );

-- comments
drop policy if exists "comments_insert" on comments;
create policy "comments_insert" on comments
  for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and exists (select 1 from payment_requests r where r.id = comments.request_id)
  );

-- comment_mentions
drop policy if exists "mentions_insert" on comment_mentions;
create policy "mentions_insert" on comment_mentions
  for insert to authenticated
  with check (
    exists (select 1 from comments c
      where c.id = comment_mentions.comment_id and c.author_id = (select auth.uid()))
  );

-- attachments
drop policy if exists "attachments_insert" on attachments;
create policy "attachments_insert" on attachments
  for insert to authenticated
  with check (uploaded_by = (select auth.uid()));

-- notifications
drop policy if exists "notifications_select" on notifications;
create policy "notifications_select" on notifications
  for select to authenticated
  using (recipient_id = (select auth.uid()));

drop policy if exists "notifications_update_own" on notifications;
create policy "notifications_update_own" on notifications
  for update to authenticated
  using (recipient_id = (select auth.uid()))
  with check (recipient_id = (select auth.uid()));

-- push_subscriptions
drop policy if exists "push_subs_all_own" on push_subscriptions;
create policy "push_subs_all_own" on push_subscriptions
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 2) Consolidate duplicate permissive policies
--
-- The pattern: table has both a broad `<table>_read` and an admin `<table>_admin`
-- for select. Since admin_all covers everyone-authenticated is already implicit
-- for admins, we can drop the admin-specific SELECT and keep only the general
-- read. Admin still gets INSERT/UPDATE/DELETE via the *_admin FOR ALL policy.
-- We'll split the *_admin policies into WRITE-only (insert/update/delete) so
-- SELECT is served by only one policy.
-- ---------------------------------------------------------------------------

-- outlets
drop policy if exists "outlets_admin" on outlets;
create policy "outlets_admin_write" on outlets
  for insert to authenticated with check (has_role('admin'));
create policy "outlets_admin_update" on outlets
  for update to authenticated using (has_role('admin')) with check (has_role('admin'));
create policy "outlets_admin_delete" on outlets
  for delete to authenticated using (has_role('admin'));

-- expense_categories
drop policy if exists "categories_admin" on expense_categories;
create policy "categories_admin_write" on expense_categories
  for insert to authenticated with check (has_role('admin'));
create policy "categories_admin_update" on expense_categories
  for update to authenticated using (has_role('admin')) with check (has_role('admin'));
create policy "categories_admin_delete" on expense_categories
  for delete to authenticated using (has_role('admin'));

-- expense_subcategories
drop policy if exists "subcategories_admin" on expense_subcategories;
create policy "subcategories_admin_write" on expense_subcategories
  for insert to authenticated with check (has_role('admin'));
create policy "subcategories_admin_update" on expense_subcategories
  for update to authenticated using (has_role('admin')) with check (has_role('admin'));
create policy "subcategories_admin_delete" on expense_subcategories
  for delete to authenticated using (has_role('admin'));

-- coa_heads
drop policy if exists "coa_admin" on coa_heads;
create policy "coa_admin_write" on coa_heads
  for insert to authenticated with check (has_role('admin'));
create policy "coa_admin_update" on coa_heads
  for update to authenticated using (has_role('admin')) with check (has_role('admin'));
create policy "coa_admin_delete" on coa_heads
  for delete to authenticated using (has_role('admin'));

-- profiles admin_all → drop and split
drop policy if exists "profiles_admin_all" on profiles;
create policy "profiles_admin_write" on profiles
  for insert to authenticated with check (has_role('admin'));
create policy "profiles_admin_delete" on profiles
  for delete to authenticated using (has_role('admin'));
-- (profiles_read_all_authenticated already covers SELECT for everyone,
--  profiles_update_own covers self-update; admins can update via admin override
--  in server actions with the admin client.)

-- user_roles admin_all → drop and split
drop policy if exists "user_roles_admin_all" on user_roles;
create policy "user_roles_admin_write" on user_roles
  for insert to authenticated with check (has_role('admin'));
create policy "user_roles_admin_update" on user_roles
  for update to authenticated using (has_role('admin')) with check (has_role('admin'));
create policy "user_roles_admin_delete" on user_roles
  for delete to authenticated using (has_role('admin'));

-- payment_records — collapse select duplication (payment_records_write was FOR ALL)
drop policy if exists "payment_records_write" on payment_records;
create policy "payment_records_insert" on payment_records
  for insert to authenticated with check (has_any_role(array['accounts', 'admin']::user_role[]));
create policy "payment_records_update" on payment_records
  for update to authenticated
  using (has_any_role(array['accounts', 'admin']::user_role[]))
  with check (has_any_role(array['accounts', 'admin']::user_role[]));
create policy "payment_records_delete" on payment_records
  for delete to authenticated using (has_any_role(array['accounts', 'admin']::user_role[]));

-- request_outlets — collapse select duplication
drop policy if exists "req_outlets_write" on request_outlets;
create policy "req_outlets_insert" on request_outlets
  for insert to authenticated
  with check (
    exists (select 1 from payment_requests r where r.id = request_outlets.request_id
      and (r.submitter_id = (select auth.uid())
           or has_any_role(array['approver', 'accounts', 'admin']::user_role[])))
  );
create policy "req_outlets_update" on request_outlets
  for update to authenticated
  using (
    exists (select 1 from payment_requests r where r.id = request_outlets.request_id
      and (r.submitter_id = (select auth.uid())
           or has_any_role(array['approver', 'accounts', 'admin']::user_role[])))
  )
  with check (
    exists (select 1 from payment_requests r where r.id = request_outlets.request_id
      and (r.submitter_id = (select auth.uid())
           or has_any_role(array['approver', 'accounts', 'admin']::user_role[])))
  );
create policy "req_outlets_delete" on request_outlets
  for delete to authenticated
  using (
    exists (select 1 from payment_requests r where r.id = request_outlets.request_id
      and (r.submitter_id = (select auth.uid())
           or has_any_role(array['approver', 'accounts', 'admin']::user_role[])))
  );

-- payment_requests — split requests_update_staff so it doesn't duplicate the
-- draft update policy for SELECT/DELETE. Keep as an UPDATE-only policy.
-- (No action needed; requests_update_staff is already scoped to UPDATE.)

-- ---------------------------------------------------------------------------
-- 3) Add covering indexes on foreign keys that lacked them
-- ---------------------------------------------------------------------------

create index if not exists idx_attachments_uploaded_by on attachments(uploaded_by);
create index if not exists idx_audit_log_actor on audit_log(actor_id);
create index if not exists idx_audit_log_vendor on audit_log(vendor_id);
create index if not exists idx_coa_override_actor on coa_override_log(actor_id);
create index if not exists idx_coa_override_new_coa on coa_override_log(new_coa_head_id);
create index if not exists idx_coa_override_old_coa on coa_override_log(old_coa_head_id);
create index if not exists idx_comment_mentions_user on comment_mentions(mentioned_user_id);
create index if not exists idx_comments_author on comments(author_id);
create index if not exists idx_subcategories_default_coa on expense_subcategories(default_coa_head_id);
create index if not exists idx_notifications_actor on notifications(actor_id);
create index if not exists idx_notifications_request on notifications(request_id);
create index if not exists idx_notifications_vendor on notifications(vendor_id);
create index if not exists idx_payment_records_recorded_by on payment_records(recorded_by);
create index if not exists idx_requests_approver on payment_requests(approver_id);
create index if not exists idx_requests_category on payment_requests(category_id);
create index if not exists idx_requests_subcategory on payment_requests(subcategory_id);
create index if not exists idx_status_history_actor on status_history(actor_id);
create index if not exists idx_vendors_submitted_by on vendors(submitted_by);
create index if not exists idx_vendors_verified_by on vendors(verified_by);
