-- Admin deletion of requests, and deactivation that actually deactivates.
--
-- Every child table cascades off payment_requests — including status_history,
-- audit_log and payment_records. So deleting a request erases its own history
-- along with it and leaves nothing behind saying it ever existed. This table
-- deliberately holds NO foreign key to payment_requests, so the record of the
-- deletion survives the thing it describes.

create table if not exists public.deleted_requests (
  id uuid primary key default gen_random_uuid(),
  request_number text not null,
  title text,
  vendor_name text,
  submitter_email text,
  -- Denormalised on purpose: the rows these came from are gone.
  installment_count int not null default 0,
  total_requested numeric(14, 2) not null default 0,
  total_paid numeric(14, 2) not null default 0,
  statuses text,
  attachment_count int not null default 0,
  reason text,
  deleted_by uuid references auth.users (id) on delete set null,
  deleted_by_email text,
  deleted_at timestamptz not null default now()
);

create index if not exists deleted_requests_deleted_at_idx
  on public.deleted_requests (deleted_at desc);

alter table public.deleted_requests enable row level security;

-- Readable by admins; only ever written through the service-role client.
drop policy if exists deleted_requests_admin_read on public.deleted_requests;
create policy deleted_requests_admin_read on public.deleted_requests
  for select to authenticated
  using (has_role('admin'::user_role));

-- ---------------------------------------------------------------------------
-- Deactivation
--
-- profiles.is_active already existed and was already shown in the admin list,
-- but nothing anywhere read it — marking someone inactive changed a boolean
-- and nothing else. The application now checks it on every request; this
-- backstops the roles half, so an inactive account cannot hold a role even if
-- one is granted by mistake.

create or replace function public.strip_roles_when_deactivated()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_active = false and coalesce(old.is_active, true) = true then
    delete from public.user_roles where user_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_strip_roles_on_deactivate on public.profiles;
create trigger profiles_strip_roles_on_deactivate
  after update of is_active on public.profiles
  for each row
  execute function public.strip_roles_when_deactivated();
