-- ============================================================================
-- Self-named category anchors (fixes report bucketing for category-level lines).
--
-- 019 used the pre-existing rollup rows as anchors for nested categories, but
-- those rows carry the PARENT name in their category column, so a category-
-- level line would show under the parent in "group by category" reports.
--
-- Instead every category gets a SELF-NAMED anchor: a row where
-- subcategory = category = the category's own name. Its category column is
-- its own name, so reports bucket it correctly. The server finds-or-creates
-- these on demand (createThread), so this backfill is a convenience, not the
-- source of truth.
--
-- The NOT EXISTS deliberately ignores is_active, matching the server rule:
-- a DEACTIVATED anchor means an admin blocked whole-category charging, and
-- neither the server nor a re-run of this migration may resurrect it.
-- ============================================================================

insert into coa_accounts (subcategory, category, coa)
select distinct c.category, c.category, c.coa
from coa_accounts c
where c.is_active = true
  and not exists (
    select 1 from coa_accounts a
    where a.coa = c.coa
      and a.subcategory = c.category
      and a.category = c.category
  );
