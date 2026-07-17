/**
 * Chart-of-Accounts helpers shared between the picker, the admin tree,
 * and the server action.
 *
 * "Rollup" rows: some rows in the flat coa_accounts table exist only to
 * anchor a category label (e.g. subcategory="Structural & Civil Works-WIP"
 * under category="Capital Work-in-Progress"), while other rows use that
 * same subcategory name as their CATEGORY value ("Structural & Civil
 * Works-WIP" grouping "-Contractor Fees / -Labor / -Materials"). The
 * anchor row is not a real spendable leaf — it's a rollup parent — so
 * it must not be picked on a payment request.
 *
 * Detection rule: a row is a rollup iff its subcategory string appears
 * as the category value on any other row within the same COA head.
 */

export type CoaLike = {
  id: string;
  subcategory: string;
  category: string;
  coa: string;
};

/** Set of coa_account row ids that should NOT be selectable as leaves. */
export function computeRollupIds<T extends CoaLike>(rows: T[]): Set<string> {
  // Per-COA set of category names in use.
  const categoriesByCoa = new Map<string, Set<string>>();
  for (const r of rows) {
    let set = categoriesByCoa.get(r.coa);
    if (!set) {
      set = new Set();
      categoriesByCoa.set(r.coa, set);
    }
    set.add(r.category);
  }
  const rollups = new Set<string>();
  for (const r of rows) {
    const cats = categoriesByCoa.get(r.coa);
    // A row is a rollup iff its subcategory names an existing category
    // AND that category is different from the row's own (otherwise it's
    // just a leaf that happens to share the group name).
    if (cats?.has(r.subcategory) && r.subcategory !== r.category) {
      rollups.add(r.id);
    }
  }
  return rollups;
}
