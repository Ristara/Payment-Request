-- Reliable per-year request number: PR-YYYY-NNNNN, monotonically increasing.
-- Uses a dedicated sequence so concurrent inserts never collide.

create sequence if not exists request_number_seq;

create or replace function next_request_number()
returns text
language sql
security definer
set search_path = public
as $$
  select 'PR-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('request_number_seq')::text, 5, '0');
$$;

-- Allow the app roles (server actions authenticate as authenticated) to call it.
grant execute on function next_request_number() to authenticated, anon, service_role;
