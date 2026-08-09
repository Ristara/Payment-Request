-- The procurement role is not used. Whoever raises a request also sources it
-- and records the PO — the owner's call, and it matches how the company works.
--
-- The enum VALUE stays. Postgres cannot drop one without recreating the type
-- and rewriting every column that uses it, which is not worth doing to remove
-- something nothing references. Nothing grants it and nothing checks for it,
-- so it is inert.
drop policy if exists procurement_select on public.procurement_requests;
create policy procurement_select on public.procurement_requests
  for select using (
    submitter_id = (select auth.uid())
    or has_any_role(array['approver'::user_role, 'accounts'::user_role, 'admin'::user_role])
  );
