-- ============================================================================
-- Row Level Security policies. Enforces the permissions matrix from §08.
--
-- Rules of thumb:
--   - Requester sees own requests only (by submitter_id).
--   - Approver / Accounts / Admin see all requests.
--   - Everyone can raise a request. Only Approver can approve.
--   - Only Accounts can approve vendors and record payments.
--   - Only Admin manages masters (outlets, categories, subcategories,
--     COA heads, user roles).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Helper: has_role(role) — checks if the current user holds a given role.
-- ---------------------------------------------------------------------------

create or replace function public.has_role(target_role user_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and role = target_role
  );
$$;

create or replace function public.has_any_role(target_roles user_role[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and role = any(target_roles)
  );
$$;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

alter table profiles enable row level security;

drop policy if exists "profiles_read_all_authenticated" on profiles;
create policy "profiles_read_all_authenticated" on profiles
  for select to authenticated using (true);

drop policy if exists "profiles_update_own" on profiles;
create policy "profiles_update_own" on profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

drop policy if exists "profiles_admin_all" on profiles;
create policy "profiles_admin_all" on profiles
  for all to authenticated
  using (has_role('admin'))
  with check (has_role('admin'));

-- ---------------------------------------------------------------------------
-- user_roles
-- ---------------------------------------------------------------------------

alter table user_roles enable row level security;

drop policy if exists "user_roles_read_all" on user_roles;
create policy "user_roles_read_all" on user_roles
  for select to authenticated using (true);

drop policy if exists "user_roles_admin_all" on user_roles;
create policy "user_roles_admin_all" on user_roles
  for all to authenticated
  using (has_role('admin'))
  with check (has_role('admin'));

-- ---------------------------------------------------------------------------
-- outlets, categories, subcategories, coa_heads
-- Everyone reads. Only Admin writes.
-- ---------------------------------------------------------------------------

alter table outlets enable row level security;
drop policy if exists "outlets_read" on outlets;
create policy "outlets_read" on outlets for select to authenticated using (true);
drop policy if exists "outlets_admin" on outlets;
create policy "outlets_admin" on outlets for all to authenticated
  using (has_role('admin')) with check (has_role('admin'));

alter table expense_categories enable row level security;
drop policy if exists "categories_read" on expense_categories;
create policy "categories_read" on expense_categories for select to authenticated using (true);
drop policy if exists "categories_admin" on expense_categories;
create policy "categories_admin" on expense_categories for all to authenticated
  using (has_role('admin')) with check (has_role('admin'));

alter table expense_subcategories enable row level security;
drop policy if exists "subcategories_read" on expense_subcategories;
create policy "subcategories_read" on expense_subcategories for select to authenticated using (true);
drop policy if exists "subcategories_admin" on expense_subcategories;
create policy "subcategories_admin" on expense_subcategories for all to authenticated
  using (has_role('admin')) with check (has_role('admin'));

alter table coa_heads enable row level security;
drop policy if exists "coa_read" on coa_heads;
create policy "coa_read" on coa_heads for select to authenticated using (true);
drop policy if exists "coa_admin" on coa_heads;
create policy "coa_admin" on coa_heads for all to authenticated
  using (has_role('admin')) with check (has_role('admin'));

-- ---------------------------------------------------------------------------
-- vendors
-- Everyone can read approved vendors + their own submissions.
-- Anyone can submit a new vendor (status defaults to 'pending').
-- Only Accounts / Admin can approve or reject (via update).
-- ---------------------------------------------------------------------------

alter table vendors enable row level security;

drop policy if exists "vendors_select" on vendors;
create policy "vendors_select" on vendors
  for select to authenticated
  using (
    status = 'approved'
    or submitted_by = auth.uid()
    or has_any_role(array['approver', 'accounts', 'admin']::user_role[])
  );

drop policy if exists "vendors_insert" on vendors;
create policy "vendors_insert" on vendors
  for insert to authenticated
  with check (submitted_by = auth.uid());

drop policy if exists "vendors_update_accounts" on vendors;
create policy "vendors_update_accounts" on vendors
  for update to authenticated
  using (has_any_role(array['accounts', 'admin']::user_role[]))
  with check (has_any_role(array['accounts', 'admin']::user_role[]));

-- ---------------------------------------------------------------------------
-- payment_requests
-- Requester sees own. Approver / Accounts / Admin see all.
-- Anyone can insert (they become the submitter).
-- Update permissions are enforced at the server-action level based on
-- current status + user role, but we also lock down: requester can only
-- edit own drafts here.
-- ---------------------------------------------------------------------------

alter table payment_requests enable row level security;

drop policy if exists "requests_select" on payment_requests;
create policy "requests_select" on payment_requests
  for select to authenticated
  using (
    submitter_id = auth.uid()
    or has_any_role(array['approver', 'accounts', 'admin']::user_role[])
  );

drop policy if exists "requests_insert" on payment_requests;
create policy "requests_insert" on payment_requests
  for insert to authenticated
  with check (submitter_id = auth.uid());

drop policy if exists "requests_update_own_draft" on payment_requests;
create policy "requests_update_own_draft" on payment_requests
  for update to authenticated
  using (submitter_id = auth.uid() and status = 'draft')
  with check (submitter_id = auth.uid());

drop policy if exists "requests_update_staff" on payment_requests;
create policy "requests_update_staff" on payment_requests
  for update to authenticated
  using (has_any_role(array['approver', 'accounts', 'admin']::user_role[]))
  with check (has_any_role(array['approver', 'accounts', 'admin']::user_role[]));

drop policy if exists "requests_delete_own_draft" on payment_requests;
create policy "requests_delete_own_draft" on payment_requests
  for delete to authenticated
  using (submitter_id = auth.uid() and status = 'draft');

-- ---------------------------------------------------------------------------
-- request_outlets — inherit visibility from parent request
-- ---------------------------------------------------------------------------

alter table request_outlets enable row level security;

drop policy if exists "req_outlets_select" on request_outlets;
create policy "req_outlets_select" on request_outlets
  for select to authenticated
  using (
    exists (select 1 from payment_requests r where r.id = request_outlets.request_id)
  );

drop policy if exists "req_outlets_write" on request_outlets;
create policy "req_outlets_write" on request_outlets
  for all to authenticated
  using (
    exists (select 1 from payment_requests r where r.id = request_outlets.request_id
      and (r.submitter_id = auth.uid()
           or has_any_role(array['approver', 'accounts', 'admin']::user_role[])))
  )
  with check (
    exists (select 1 from payment_requests r where r.id = request_outlets.request_id
      and (r.submitter_id = auth.uid()
           or has_any_role(array['approver', 'accounts', 'admin']::user_role[])))
  );

-- ---------------------------------------------------------------------------
-- status_history — everyone who sees the request sees its history.
-- Insert done via server actions using admin client (to guarantee immutability).
-- ---------------------------------------------------------------------------

alter table status_history enable row level security;

drop policy if exists "history_select" on status_history;
create policy "history_select" on status_history
  for select to authenticated
  using (
    exists (select 1 from payment_requests r where r.id = status_history.request_id)
  );

-- ---------------------------------------------------------------------------
-- coa_override_log — visible with parent request. Written via server actions.
-- ---------------------------------------------------------------------------

alter table coa_override_log enable row level security;

drop policy if exists "coa_log_select" on coa_override_log;
create policy "coa_log_select" on coa_override_log
  for select to authenticated
  using (
    exists (select 1 from payment_requests r where r.id = coa_override_log.request_id)
  );

-- ---------------------------------------------------------------------------
-- payment_records — visible with parent request. Only Accounts writes.
-- ---------------------------------------------------------------------------

alter table payment_records enable row level security;

drop policy if exists "payment_records_select" on payment_records;
create policy "payment_records_select" on payment_records
  for select to authenticated
  using (
    exists (select 1 from payment_requests r where r.id = payment_records.request_id)
  );

drop policy if exists "payment_records_write" on payment_records;
create policy "payment_records_write" on payment_records
  for all to authenticated
  using (has_any_role(array['accounts', 'admin']::user_role[]))
  with check (has_any_role(array['accounts', 'admin']::user_role[]));

-- ---------------------------------------------------------------------------
-- comments / mentions
-- ---------------------------------------------------------------------------

alter table comments enable row level security;

drop policy if exists "comments_select" on comments;
create policy "comments_select" on comments
  for select to authenticated
  using (
    exists (select 1 from payment_requests r where r.id = comments.request_id)
  );

drop policy if exists "comments_insert" on comments;
create policy "comments_insert" on comments
  for insert to authenticated
  with check (
    author_id = auth.uid()
    and exists (select 1 from payment_requests r where r.id = comments.request_id)
  );

alter table comment_mentions enable row level security;

drop policy if exists "mentions_select" on comment_mentions;
create policy "mentions_select" on comment_mentions
  for select to authenticated
  using (
    exists (select 1 from comments c
      join payment_requests r on r.id = c.request_id
      where c.id = comment_mentions.comment_id)
  );

drop policy if exists "mentions_insert" on comment_mentions;
create policy "mentions_insert" on comment_mentions
  for insert to authenticated
  with check (
    exists (select 1 from comments c
      where c.id = comment_mentions.comment_id and c.author_id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- attachments — inherit from parent request / comment / vendor
-- ---------------------------------------------------------------------------

alter table attachments enable row level security;

drop policy if exists "attachments_select" on attachments;
create policy "attachments_select" on attachments
  for select to authenticated
  using (
    (request_id is not null and exists (
      select 1 from payment_requests r where r.id = attachments.request_id))
    or (comment_id is not null and exists (
      select 1 from comments c where c.id = attachments.comment_id))
    or (vendor_id is not null and exists (
      select 1 from vendors v where v.id = attachments.vendor_id))
  );

drop policy if exists "attachments_insert" on attachments;
create policy "attachments_insert" on attachments
  for insert to authenticated
  with check (uploaded_by = auth.uid());

-- ---------------------------------------------------------------------------
-- notifications — recipient only
-- ---------------------------------------------------------------------------

alter table notifications enable row level security;

drop policy if exists "notifications_select" on notifications;
create policy "notifications_select" on notifications
  for select to authenticated
  using (recipient_id = auth.uid());

drop policy if exists "notifications_update_own" on notifications;
create policy "notifications_update_own" on notifications
  for update to authenticated
  using (recipient_id = auth.uid())
  with check (recipient_id = auth.uid());

-- ---------------------------------------------------------------------------
-- push_subscriptions — user owns theirs
-- ---------------------------------------------------------------------------

alter table push_subscriptions enable row level security;

drop policy if exists "push_subs_all_own" on push_subscriptions;
create policy "push_subs_all_own" on push_subscriptions
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- audit_log — readable by Approver / Accounts / Admin. Written via admin client.
-- ---------------------------------------------------------------------------

alter table audit_log enable row level security;

drop policy if exists "audit_select_staff" on audit_log;
create policy "audit_select_staff" on audit_log
  for select to authenticated
  using (has_any_role(array['approver', 'accounts', 'admin']::user_role[]));
