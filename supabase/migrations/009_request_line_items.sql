-- ============================================================================
-- Line items on payment requests, à la Zoho Bills.
--
-- A single payment request can now allocate its amount across multiple
-- COA accounts. Every line has its own subcategory (via coa_accounts),
-- an optional description, and an amount. The sum of line amounts must
-- equal payment_requests.payment_amount (enforced at the server-action
-- layer since Postgres CHECK can't reference other tables easily).
--
-- The old single-COA-per-request column (coa_account_id) is dropped —
-- the classification now lives on the line rows.
-- ============================================================================

create table if not exists request_line_items (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references payment_requests(id) on delete cascade,
  coa_account_id uuid not null references coa_accounts(id) on delete restrict,
  description text,
  quantity numeric(14, 3) not null default 1 check (quantity > 0),
  rate numeric(14, 2) not null check (rate >= 0),
  amount numeric(14, 2) generated always as (round(quantity * rate, 2)) stored,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_line_items_request on request_line_items(request_id, sort_order);
create index if not exists idx_line_items_coa on request_line_items(coa_account_id);

alter table request_line_items enable row level security;

drop policy if exists "line_items_select" on request_line_items;
create policy "line_items_select" on request_line_items
  for select to authenticated
  using (
    exists (select 1 from payment_requests r where r.id = request_line_items.request_id)
  );

drop policy if exists "line_items_insert" on request_line_items;
create policy "line_items_insert" on request_line_items
  for insert to authenticated
  with check (
    exists (select 1 from payment_requests r where r.id = request_line_items.request_id
      and (r.submitter_id = (select auth.uid())
           or has_any_role(array['approver', 'accounts', 'admin']::user_role[])))
  );

drop policy if exists "line_items_update" on request_line_items;
create policy "line_items_update" on request_line_items
  for update to authenticated
  using (
    exists (select 1 from payment_requests r where r.id = request_line_items.request_id
      and (r.submitter_id = (select auth.uid())
           or has_any_role(array['approver', 'accounts', 'admin']::user_role[])))
  )
  with check (
    exists (select 1 from payment_requests r where r.id = request_line_items.request_id
      and (r.submitter_id = (select auth.uid())
           or has_any_role(array['approver', 'accounts', 'admin']::user_role[])))
  );

drop policy if exists "line_items_delete" on request_line_items;
create policy "line_items_delete" on request_line_items
  for delete to authenticated
  using (
    exists (select 1 from payment_requests r where r.id = request_line_items.request_id
      and (r.submitter_id = (select auth.uid())
           or has_any_role(array['approver', 'accounts', 'admin']::user_role[])))
  );

-- Drop the old single-COA link on payment_requests.
alter table payment_requests drop constraint if exists payment_requests_coa_account_id_fkey;
alter table payment_requests drop column if exists coa_account_id;

-- coa_override_log referenced request-level coa_account_id — no longer meaningful.
-- Drop the columns; we can re-add per-line override logging later if needed.
alter table coa_override_log drop column if exists old_coa_account_id;
alter table coa_override_log drop column if exists new_coa_account_id;
