-- ============================================================================
-- Payment Request Management System — Phase 1 initial schema
-- Rev 0.2 of the plan (16 Jul 2026)
--
-- Includes:
--   - Roles + profiles
--   - Outlets, Categories → Subcategories → COA Heads hierarchy
--   - Vendors (with two-step Accounts approval)
--   - Payment requests (multi-outlet, category-mapped, COA-override-able)
--   - Discussion, attachments, notifications, push subscriptions
--   - Immutable status history + audit + COA override log
-- ============================================================================

-- Extensions
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

do $$ begin
  create type user_role as enum ('requester', 'approver', 'accounts', 'admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type request_status as enum (
    'draft',
    'pending_approval',
    'clarification_required',
    'approved',
    'uploaded_in_bank',
    'payment_processed',
    'invoice_pending',
    'closed',
    'returned_for_correction',
    'rejected',
    'cancelled'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type vendor_status as enum ('pending', 'approved', 'rejected');
exception when duplicate_object then null; end $$;

do $$ begin
  create type supply_composition as enum ('material', 'service', 'mixed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type payment_mode as enum ('neft', 'rtgs', 'imps');
exception when duplicate_object then null; end $$;

do $$ begin
  create type attachment_stage as enum ('request', 'payment', 'invoice', 'comment', 'vendor');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- profiles: extends auth.users
-- ---------------------------------------------------------------------------

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text not null,
  phone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_profiles_email on profiles(email);

-- ---------------------------------------------------------------------------
-- user_roles: many-to-many. A user can hold multiple roles.
-- ---------------------------------------------------------------------------

create table if not exists user_roles (
  user_id uuid not null references profiles(id) on delete cascade,
  role user_role not null,
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

create index if not exists idx_user_roles_role on user_roles(role);

-- ---------------------------------------------------------------------------
-- outlets: master. Cost centres tie to outlets.
-- ---------------------------------------------------------------------------

create table if not exists outlets (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  cost_centre text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Chart of Accounts: master.
-- Each subcategory maps to a default COA head. Reporting rolls up by COA.
-- ---------------------------------------------------------------------------

create table if not exists coa_heads (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Expense categories → subcategories.
-- Subcategory has a mandatory default COA head.
-- ---------------------------------------------------------------------------

create table if not exists expense_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists expense_subcategories (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references expense_categories(id) on delete restrict,
  name text not null,
  default_coa_head_id uuid not null references coa_heads(id) on delete restrict,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (category_id, name)
);

create index if not exists idx_subcategories_category on expense_subcategories(category_id);

-- ---------------------------------------------------------------------------
-- vendors: two-step creation. Requester submits → Accounts approves.
-- ---------------------------------------------------------------------------

create table if not exists vendors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  gstin text not null,
  pan text not null,
  bank_account_number text not null,
  bank_ifsc text not null,
  bank_name text,
  bank_branch text,
  cancelled_cheque_path text,           -- storage path in bucket "vendor-docs"
  status vendor_status not null default 'pending',
  submitted_by uuid not null references profiles(id) on delete restrict,
  verified_by uuid references profiles(id) on delete set null,
  verified_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A duplicate GSTIN is a hard rule — one vendor per GSTIN.
  unique (gstin)
);

create index if not exists idx_vendors_status on vendors(status);
create index if not exists idx_vendors_name on vendors(name);
create index if not exists idx_vendors_gstin on vendors(gstin);

-- ---------------------------------------------------------------------------
-- payment_requests: the core record.
-- ---------------------------------------------------------------------------

create table if not exists payment_requests (
  id uuid primary key default gen_random_uuid(),
  request_number text not null unique,       -- e.g., PR-2026-00001
  status request_status not null default 'draft',

  -- Ownership
  submitter_id uuid not null references profiles(id) on delete restrict,

  -- Vendor
  vendor_id uuid not null references vendors(id) on delete restrict,

  -- References
  po_number text,
  po_not_applicable_reason text,
  invoice_reference text,                    -- proforma or invoice number if available

  -- Money
  total_bill_value numeric(14, 2) not null,
  payment_percentage numeric(5, 2),          -- optional; either % or fixed
  payment_amount numeric(14, 2) not null,    -- always set (computed if % given)
  previous_payments numeric(14, 2) not null default 0,
  balance_payable numeric(14, 2) generated always as
    (total_bill_value - previous_payments - payment_amount) stored,

  -- Dates
  payment_due_date date not null,
  date_of_work_completion date,
  tentative_invoice_date date,               -- required if no invoice attached

  -- Classification
  category_id uuid not null references expense_categories(id) on delete restrict,
  subcategory_id uuid not null references expense_subcategories(id) on delete restrict,
  coa_head_id uuid not null references coa_heads(id) on delete restrict,
                                             -- auto-filled from subcategory; override-able

  -- Supply
  supply_composition supply_composition not null,
  material_percentage numeric(5, 2),         -- required if mixed
  service_percentage numeric(5, 2),          -- required if mixed
  constraint check_mix_percentages check (
    supply_composition <> 'mixed'
    or (material_percentage is not null
        and service_percentage is not null
        and abs((material_percentage + service_percentage) - 100) < 0.01)
  ),

  -- Business
  purpose text not null,                     -- required, free-text
  cost_centre text,                          -- defaults from primary outlet

  -- Decision metadata
  approver_id uuid references profiles(id) on delete set null,
  approved_at timestamptz,
  rejection_reason text,
  return_reason text,

  submitted_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_requests_submitter on payment_requests(submitter_id);
create index if not exists idx_requests_status on payment_requests(status);
create index if not exists idx_requests_vendor on payment_requests(vendor_id);
create index if not exists idx_requests_due_date on payment_requests(payment_due_date);
create index if not exists idx_requests_coa on payment_requests(coa_head_id);
create index if not exists idx_requests_created on payment_requests(created_at desc);

-- ---------------------------------------------------------------------------
-- request_outlets: junction. A request can span multiple outlets with
-- optional per-outlet amount split. If no split rows sum to the total,
-- treat as "shared / not split".
-- ---------------------------------------------------------------------------

create table if not exists request_outlets (
  request_id uuid not null references payment_requests(id) on delete cascade,
  outlet_id uuid not null references outlets(id) on delete restrict,
  split_amount numeric(14, 2),              -- optional per-outlet amount
  primary key (request_id, outlet_id)
);

create index if not exists idx_request_outlets_outlet on request_outlets(outlet_id);

-- ---------------------------------------------------------------------------
-- Sequence for request_number generation. Yearly reset via app logic.
-- ---------------------------------------------------------------------------

create sequence if not exists request_number_seq start with 1 increment by 1;

-- ---------------------------------------------------------------------------
-- status_history: immutable log of every status transition.
-- ---------------------------------------------------------------------------

create table if not exists status_history (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references payment_requests(id) on delete cascade,
  actor_id uuid not null references profiles(id) on delete restrict,
  from_status request_status,               -- null for initial creation
  to_status request_status not null,
  comment text,
  created_at timestamptz not null default now()
);

create index if not exists idx_status_history_request on status_history(request_id, created_at);

-- ---------------------------------------------------------------------------
-- coa_override_log: when Approver or Accounts changes the COA on a request.
-- ---------------------------------------------------------------------------

create table if not exists coa_override_log (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references payment_requests(id) on delete cascade,
  actor_id uuid not null references profiles(id) on delete restrict,
  old_coa_head_id uuid not null references coa_heads(id) on delete restrict,
  new_coa_head_id uuid not null references coa_heads(id) on delete restrict,
  reason text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_coa_override_request on coa_override_log(request_id, created_at);

-- ---------------------------------------------------------------------------
-- payment_records: one per request. Accounts fills after bank success.
-- ---------------------------------------------------------------------------

create table if not exists payment_records (
  request_id uuid primary key references payment_requests(id) on delete cascade,
  bank_upload_date date,
  bank_batch_ref text,
  payment_mode payment_mode not null default 'neft',
  payment_date date,
  paid_amount numeric(14, 2),
  utr_reference text,
  paying_bank_account text,
  recorded_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- comments: threaded discussion on a request.
-- ---------------------------------------------------------------------------

create table if not exists comments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references payment_requests(id) on delete cascade,
  author_id uuid not null references profiles(id) on delete cascade,
  body text not null check (length(trim(body)) > 0 or body = '(attachment)'),
  is_question boolean not null default false,
  question_state text check (question_state in ('open', 'answered', 'resolved')),
  created_at timestamptz not null default now()
);

create index if not exists idx_comments_request on comments(request_id, created_at);

-- ---------------------------------------------------------------------------
-- comment_mentions: @-tags that drive notifications.
-- ---------------------------------------------------------------------------

create table if not exists comment_mentions (
  comment_id uuid not null references comments(id) on delete cascade,
  mentioned_user_id uuid not null references profiles(id) on delete cascade,
  primary key (comment_id, mentioned_user_id)
);

-- ---------------------------------------------------------------------------
-- attachments: linked to a request or a comment; tagged by stage.
-- ---------------------------------------------------------------------------

create table if not exists attachments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid references payment_requests(id) on delete cascade,
  comment_id uuid references comments(id) on delete cascade,
  vendor_id uuid references vendors(id) on delete cascade,
  stage attachment_stage not null,
  storage_path text not null,
  file_name text not null,
  file_size_bytes bigint not null,
  mime_type text,
  uploaded_by uuid not null references profiles(id) on delete restrict,
  uploaded_at timestamptz not null default now(),
  -- Exactly one of (request, comment, vendor) must be set.
  check (
    (request_id is not null)::int
    + (comment_id is not null)::int
    + (vendor_id is not null)::int = 1
  )
);

create index if not exists idx_attachments_request on attachments(request_id);
create index if not exists idx_attachments_comment on attachments(comment_id);
create index if not exists idx_attachments_vendor on attachments(vendor_id);

-- ---------------------------------------------------------------------------
-- notifications: in-app inbox rows.
-- ---------------------------------------------------------------------------

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references profiles(id) on delete cascade,
  actor_id uuid references profiles(id) on delete set null,
  kind text not null,                        -- e.g., 'request_submitted', 'clarification_asked'
  request_id uuid references payment_requests(id) on delete cascade,
  vendor_id uuid references vendors(id) on delete cascade,
  body text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_notifications_recipient on notifications(recipient_id, created_at desc);
create index if not exists idx_notifications_unread on notifications(recipient_id)
  where read_at is null;

-- ---------------------------------------------------------------------------
-- push_subscriptions: PWA push endpoints per device.
-- ---------------------------------------------------------------------------

create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh_key text not null,
  auth_key text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists idx_push_subs_user on push_subscriptions(user_id);

-- ---------------------------------------------------------------------------
-- audit_log: financial-field edits and admin overrides.
-- ---------------------------------------------------------------------------

create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  request_id uuid references payment_requests(id) on delete cascade,
  vendor_id uuid references vendors(id) on delete cascade,
  actor_id uuid not null references profiles(id) on delete restrict,
  action text not null,                      -- e.g., 'amount_edit', 'admin_override', 'bank_edit'
  field_name text,
  old_value text,
  new_value text,
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_request on audit_log(request_id, created_at);

-- ---------------------------------------------------------------------------
-- updated_at trigger helper
-- ---------------------------------------------------------------------------

create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

do $$
declare
  t text;
begin
  for t in
    select table_name from information_schema.columns
    where table_schema = 'public'
      and column_name = 'updated_at'
      and table_name in (
        'profiles', 'outlets', 'coa_heads', 'expense_categories',
        'expense_subcategories', 'vendors', 'payment_requests',
        'payment_records'
      )
  loop
    execute format(
      'drop trigger if exists trg_%1$s_updated on %1$s;
       create trigger trg_%1$s_updated before update on %1$s
         for each row execute function set_updated_at();',
       t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- profiles auto-create on auth.users insert
-- ---------------------------------------------------------------------------

create or replace function handle_new_user() returns trigger as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
