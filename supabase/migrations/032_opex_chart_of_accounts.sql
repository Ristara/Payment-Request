-- Separate charts of accounts for CapEx and OpEx.
--
-- They are different shapes, not two halves of one tree. CapEx is three
-- levels (Category / Sub category / Account); OpEx as supplied is two
-- (Category / Account) — 69 accounts across 14 categories.
--
-- Rather than add a fourth nullable column, OpEx rows repeat the category in
-- the middle slot. The unique index is (coa, category, subcategory), so
-- (Category, Category, Account) is still unique per Category+Account, and
-- every existing query that groups by `coa` or `category` keeps working
-- without knowing which shape it is looking at.

alter table public.coa_accounts
  add column if not exists expense_type expense_type not null default 'capex';

comment on column public.coa_accounts.expense_type is
  'Which chart this account belongs to. CapEx uses coa/category/subcategory; OpEx repeats the category in `category` and holds the account in `subcategory`.';

create index if not exists coa_accounts_expense_type_idx
  on public.coa_accounts (expense_type, coa, category, subcategory);

-- A request may only be coded to accounts from its own chart. Enforced at the
-- line item, which is where the account is chosen.
create or replace function public.line_matches_expense_type(
  p_request_id uuid,
  p_coa_account_id uuid
) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1
    from public.payment_requests r
    join public.coa_accounts a on a.id = p_coa_account_id
    where r.id = p_request_id
      and a.expense_type is distinct from r.expense_type
  );
$$;

alter table public.request_line_items
  drop constraint if exists request_line_items_expense_type_match;

-- A trigger rather than a check constraint: the rule spans two other tables,
-- which a CHECK can't reach.
create or replace function public.enforce_line_expense_type()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.line_matches_expense_type(new.request_id, new.coa_account_id) then
    raise exception 'That account belongs to the other chart of accounts.';
  end if;
  return new;
end;
$$;

drop trigger if exists line_items_expense_type on public.request_line_items;
create trigger line_items_expense_type
  before insert or update of coa_account_id on public.request_line_items
  for each row
  execute function public.enforce_line_expense_type();
