"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { FilterPanel, FilterSelect, type ActiveChip } from "@/components/ListFilters";

export type BranchOption = { id: string; name: string };

const EXPENSE_LABEL: Record<string, string> = { capex: "CapEx", opex: "OpEx" };
const KIND_LABEL: Record<string, string> = { regular: "Regular", milestone: "Milestone" };
const STAGE_LABEL: Record<string, string> = {
  upcoming: "New Store",
  operational: "Existing Outlet",
};

/**
 * Filters for My requests.
 *
 * URL-driven, unlike the Approvals panel, because this list is PAGINATED and
 * filtering happens in SQL. Local state would filter only the page in front of
 * you and report "3 results" out of thirty — a lie that looks like a working
 * feature.
 *
 * Changing anything drops `page`, so you always land on the first page of the
 * new result set rather than page 4 of a one-page list.
 */
export default function RequestFilters({ branches }: { branches: BranchOption[] }) {
  const router = useRouter();
  const params = useSearchParams();

  const get = (k: string) => params.get(k) ?? "";
  const expense = get("exp");

  function apply(patch: Record<string, string>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    // Always back to the first page: the old page number belongs to a result
    // set that no longer exists.
    next.delete("page");
    router.push(`/requests?${next.toString()}`);
  }

  // OpEx is always an existing outlet and always a regular payment — the Raise
  // form does not ask, so offering them here would be filtering by a choice
  // nobody made. Cleared, not just hidden: a filter narrowing the list from off
  // screen is the worst version of this.
  const capexOnly = expense !== "opex";
  const chooseExpense = (v: string) =>
    apply(v === "opex" ? { exp: v, stage: "", kind: "" } : { exp: v });

  const chips: ActiveChip[] = [];
  const branchName = branches.find((b) => b.id === get("branch"))?.name;
  if (branchName) chips.push({ label: `Branch: ${branchName}`, onClear: () => apply({ branch: "" }) });
  if (expense) chips.push({ label: EXPENSE_LABEL[expense] ?? expense, onClear: () => apply({ exp: "" }) });
  if (get("stage")) {
    chips.push({ label: STAGE_LABEL[get("stage")] ?? get("stage"), onClear: () => apply({ stage: "" }) });
  }
  if (get("kind")) {
    chips.push({ label: `${KIND_LABEL[get("kind")] ?? get("kind")} payment`, onClear: () => apply({ kind: "" }) });
  }

  return (
    <FilterPanel
      chips={chips}
      onClearAll={() => apply({ branch: "", exp: "", stage: "", kind: "" })}
    >
      <FilterSelect
        label="Branch"
        value={get("branch")}
        onChange={(v) => apply({ branch: v })}
        anyLabel="All branches"
        options={branches.map((b) => ({ value: b.id, label: b.name }))}
      />
      <FilterSelect
        label="Expense type"
        value={expense}
        onChange={chooseExpense}
        anyLabel="CapEx and OpEx"
        options={[
          { value: "capex", label: "CapEx — assets & construction" },
          { value: "opex", label: "OpEx — rent & utilities" },
        ]}
      />
      {capexOnly && (
        <>
          <FilterSelect
            label="Payment for"
            value={get("stage")}
            onChange={(v) => apply({ stage: v })}
            anyLabel="New and existing"
            options={[
              { value: "upcoming", label: "New Store" },
              { value: "operational", label: "Existing Outlet" },
            ]}
          />
          <FilterSelect
            label="Payment kind"
            value={get("kind")}
            onChange={(v) => apply({ kind: v })}
            anyLabel="Regular and milestone"
            options={[
              { value: "regular", label: "Regular — one-off / part" },
              { value: "milestone", label: "Milestone" },
            ]}
          />
        </>
      )}
    </FilterPanel>
  );
}
