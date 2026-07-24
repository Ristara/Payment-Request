-- ============================================================================
-- Category-level line items.
--
-- The raise form now offers Category (required) + Subcategory (optional).
-- When the submitter skips the subcategory, the line is charged to the
-- category itself, stored against the category's "anchor" row — the
-- coa_accounts row whose subcategory equals the category name.
--
-- Most categories already have such an anchor (the rollup rows). The flat
-- top-level ones (category = COA head, e.g. "Motor Vehicles") don't, so
-- insert self-named anchor rows for them here.
-- ============================================================================

insert into coa_accounts (subcategory, category, coa)
select distinct c.category, c.category, c.coa
from coa_accounts c
where c.is_active = true
  and not exists (
    select 1 from coa_accounts a
    where a.coa = c.coa and a.subcategory = c.category
  );
