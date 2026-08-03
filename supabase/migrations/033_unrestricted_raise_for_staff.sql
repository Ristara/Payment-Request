-- Approvers and accounts raise for any branch and either expense type.
--
-- Migration 031 exempted admins alone, for a bootstrap reason: a fresh install
-- needs somebody able to set the grants up in the first place.
--
-- Approver and accounts join them for a different reason. Both roles already
-- see, approve and pay every request in the company, regardless of branch —
-- 031 says so itself: "What someone can see, approve or pay is unchanged."
-- So requiring a branch grant before they could RAISE against a branch they
-- can already authorise payment for protected nothing. It only produced
-- people who could sign off a payment they were not allowed to ask for.
--
-- What this does NOT change, deliberately:
--
--   * The requester-role requirement in requests_insert. Raising still needs
--     the requester or admin role. Someone with accounts alone still cannot
--     raise, and that is a separate decision from this one.
--   * Self-approval. approveInstallment refuses when the submitter is the
--     approver, whoever they are. That check is the entire reason widening
--     this is safe, and it must not be removed.
--
-- Mirrored in TypeScript by UNRESTRICTED_RAISE_ROLES in src/lib/access-labels.ts.
-- Change one and you must change the other, or the Raise form will offer a
-- branch that the database then rejects on submit.

create or replace function public.may_raise_for_outlet(p_outlet_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select has_any_role(array['admin'::user_role, 'approver'::user_role, 'accounts'::user_role])
     or exists (
       select 1 from public.user_branch_access a
       where a.user_id = (select auth.uid()) and a.outlet_id = p_outlet_id
     );
$$;

create or replace function public.may_raise_expense(p_type expense_type)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select has_any_role(array['admin'::user_role, 'approver'::user_role, 'accounts'::user_role])
     or exists (
       select 1 from public.user_expense_access a
       where a.user_id = (select auth.uid()) and a.expense_type = p_type
     );
$$;

create or replace function public.may_raise_any_branch()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select has_any_role(array['admin'::user_role, 'approver'::user_role, 'accounts'::user_role])
     or exists (
       select 1 from public.user_branch_access a where a.user_id = (select auth.uid())
     );
$$;
