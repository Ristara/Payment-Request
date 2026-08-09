"use client";

import { useMemo } from "react";
import Combobox from "@/components/Combobox";
import { COA_LABEL } from "@/lib/coa-labels";

export type CoaAccount = {
  id: string;
  /** Column `coa` — shown as Category. */
  coa: string;
  /** Column `category` — shown as Sub category. */
  category: string;
  /** Column `subcategory` — shown as Account. */
  subcategory: string;
  /** Which chart it belongs to — the two do not mix. */
  expense_type: string;
};

export type CoaSelection = { coa: string; category: string; accountId: string };

/**
 * The three-level chart-of-accounts picker: Category → Sub category → Account.
 *
 * Any level can be searched directly. Picking a lower one back-fills the ones
 * above it, because people know the account they want far more often than they
 * know which category it sits under — forcing top-down would make them hunt.
 *
 * The column names are off by one from the labels on purpose; see
 * src/lib/coa-labels.ts. `coa` is Category, `category` is Sub category and
 * `subcategory` is Account.
 *
 * OpEx has no middle level — its accounts hang straight off the top — so the
 * Sub category box is hidden rather than shown empty.
 */
export default function CoaCascade({
  accounts,
  value,
  onChange,
  isOpex = false,
  required = false,
}: {
  accounts: CoaAccount[];
  value: CoaSelection;
  onChange: (next: CoaSelection) => void;
  isOpex?: boolean;
  required?: boolean;
}) {
  const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))].sort();
  const opts = (xs: string[]) => xs.map((x) => ({ value: x, label: x }));

  const level1 = useMemo(() => opts(uniq(accounts.map((a) => a.coa))), [accounts]);

  const level2 = useMemo(() => {
    const scoped = value.coa ? accounts.filter((a) => a.coa === value.coa) : accounts;
    return opts(uniq(scoped.map((a) => a.category)));
  }, [accounts, value.coa]);

  const level3 = useMemo(() => {
    let scoped = accounts;
    if (value.coa) scoped = scoped.filter((a) => a.coa === value.coa);
    if (value.category) scoped = scoped.filter((a) => a.category === value.category);
    return scoped
      .filter((a) => a.subcategory)
      .map((a) => ({ value: a.id, label: a.subcategory }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [accounts, value.coa, value.category]);

  return (
    <div className="space-y-1.5">
      <Combobox
        options={level1}
        value={value.coa}
        // OpEx has no middle level, so the top choice fills both slots.
        onChange={(v) => onChange({ coa: v, category: isOpex ? v : "", accountId: "" })}
        onClear={() => onChange({ coa: "", category: "", accountId: "" })}
        placeholder={`Search ${COA_LABEL.level1.toLowerCase()}…`}
        ariaLabel={COA_LABEL.level1}
        required={required && !value.coa}
      />

      {!isOpex && (
        <Combobox
          options={level2}
          value={value.category}
          onChange={(v) => {
            // Back-fill the level above, so picking a sub category alone is a
            // complete choice rather than half of one.
            const parent = accounts.find((a) => a.category === v);
            onChange({ coa: value.coa || parent?.coa || "", category: v, accountId: "" });
          }}
          onClear={() => onChange({ ...value, category: "", accountId: "" })}
          placeholder={
            value.coa
              ? `Search ${COA_LABEL.level2.toLowerCase()}…`
              : `Or search any ${COA_LABEL.level2.toLowerCase()}…`
          }
          ariaLabel={COA_LABEL.level2}
        />
      )}

      <Combobox
        options={level3}
        value={value.accountId}
        onChange={(id) => {
          const a = accounts.find((x) => x.id === id);
          onChange(
            a
              ? { coa: a.coa, category: isOpex ? a.coa : a.category, accountId: a.id }
              : { ...value, accountId: "" },
          );
        }}
        onClear={() => onChange({ ...value, accountId: "" })}
        placeholder={
          value.category
            ? `Search ${COA_LABEL.level3.toLowerCase()}…`
            : `Or search any ${COA_LABEL.level3.toLowerCase()}…`
        }
        ariaLabel={COA_LABEL.level3}
      />

      <input type="hidden" name="coa" value={value.coa} />
      <input type="hidden" name="coa_category" value={value.category} />
      <input type="hidden" name="coa_account_id" value={value.accountId} />
    </div>
  );
}
