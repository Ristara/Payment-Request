/**
 * What the three levels of the chart of accounts are CALLED.
 *
 * The database columns are `coa`, `category` and `subcategory` and are not
 * renamed — they're referenced by RLS policies, the CoA importer, reports,
 * the assistant's tools and every migration since 002, and a column rename
 * buys nothing a label doesn't. So the mapping is deliberately off by one:
 *
 *   column `coa`         → shown as "Category"
 *   column `category`    → shown as "Sub category"
 *   column `subcategory` → shown as "Account"
 *
 * Anything a user reads should come from here rather than being typed out,
 * so the vocabulary can change again without another sweep of the codebase.
 */
export const COA_LABEL = {
  /** Level 1 — column `coa`. */
  level1: "Category",
  /** Level 2 — column `category`. */
  level2: "Sub category",
  /** Level 3 — column `subcategory`. Optional on a line. */
  level3: "Account",
} as const;

/** "Category · Sub category · Account" — the full path, for column headers. */
export const COA_PATH = `${COA_LABEL.level1} · ${COA_LABEL.level2} · ${COA_LABEL.level3}`;
