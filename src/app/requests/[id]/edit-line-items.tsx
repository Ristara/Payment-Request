"use client";

import { useActionState, useMemo, useState } from "react";
import { updateThreadLineItems } from "@/app/requests/actions";
import Combobox, { type ComboOption } from "@/components/Combobox";
import { computeRollupIds } from "@/lib/coa";
import { formatINR } from "@/lib/types";

type CoaAccount = { id: string; subcategory: string; category: string; coa: string };

type LineRow = {
  key: string;
  coaHead: string;
  category: string;
  coa_account_id: string;
  quantity: string;
  rate: string;
};

/**
 * Rewrite a thread's PO breakdown while nothing is approved yet. Same three
 * levels as the raise form: COA head and Category required, Subcategory
 * optional (blank charges the category).
 */
export default function EditLineItems({
  requestId,
  coaAccounts,
  initial,
  minPoValue,
}: {
  requestId: string;
  coaAccounts: CoaAccount[];
  initial: { coaAccountId: string; quantity: number; rate: number }[];
  /** Already requested on live installments — the PO can't go below this. */
  minPoValue: number;
}) {
  const [state, formAction, pending] = useActionState(updateThreadLineItems, undefined);
  const [open, setOpen] = useState(false);

  const byId = useMemo(() => {
    const m = new Map<string, CoaAccount>();
    coaAccounts.forEach((a) => m.set(a.id, a));
    return m;
  }, [coaAccounts]);

  const [lines, setLines] = useState<LineRow[]>(() =>
    initial.length > 0
      ? initial.map((l, i) => {
          const a = byId.get(l.coaAccountId);
          return {
            key: `${i}`,
            coaHead: a?.coa ?? "",
            category: a?.category ?? "",
            // A self-named anchor means "whole category" — no subcategory picked.
            coa_account_id: a && a.subcategory !== a.category ? a.id : "",
            quantity: String(l.quantity),
            rate: String(l.rate),
          };
        })
      : [blankLine()],
  );

  const rollupIds = useMemo(() => computeRollupIds(coaAccounts), [coaAccounts]);

  const coaOptions = useMemo<ComboOption[]>(
    () =>
      [...new Set(coaAccounts.map((a) => a.coa))]
        .sort((a, b) => a.localeCompare(b))
        .map((coa) => ({ value: coa, label: coa })),
    [coaAccounts],
  );

  function categoryOptionsFor(coaHead: string): ComboOption[] {
    if (!coaHead) return [];
    return [...new Set(coaAccounts.filter((a) => a.coa === coaHead).map((a) => a.category))]
      .sort((a, b) => a.localeCompare(b))
      .map((c) => ({ value: c, label: c }));
  }

  /** Every category, so a line can start at the middle level. */
  const allCategoryOptions = useMemo<ComboOption[]>(() => {
    const seen = new Set<string>();
    return coaAccounts
      .filter((a) => (seen.has(a.category) ? false : (seen.add(a.category), true)))
      .sort((x, y) => x.category.localeCompare(y.category))
      .map((a) => ({ value: a.category, label: a.category, hint: a.coa }));
  }, [coaAccounts]);

  /** Picking a category fills in its COA head. */
  function pickCategory(idx: number, category: string) {
    if (!category) {
      update(idx, { category: "", coa_account_id: "" });
      return;
    }
    const a = coaAccounts.find((x) => x.category === category);
    update(idx, { coaHead: a?.coa ?? "", category, coa_account_id: "" });
  }

  /** All spendable subcategories, so a line can be started bottom-up. */
  const allSubOptions = useMemo<ComboOption[]>(
    () =>
      coaAccounts
        .filter((a) => !rollupIds.has(a.id) && a.subcategory !== a.category)
        .sort((x, y) => x.subcategory.localeCompare(y.subcategory))
        .map((a) => ({ value: a.id, label: a.subcategory, hint: `${a.coa} › ${a.category}` })),
    [coaAccounts, rollupIds],
  );

  /** Picking a subcategory fills in the two levels above it. */
  function pickSubcategory(idx: number, accountId: string) {
    if (!accountId) {
      update(idx, { coa_account_id: "" });
      return;
    }
    const a = coaAccounts.find((x) => x.id === accountId);
    if (!a) return;
    update(idx, { coaHead: a.coa, category: a.category, coa_account_id: a.id });
  }

  function subOptionsFor(coaHead: string, category: string) {
    if (!coaHead || !category) return [];
    return coaAccounts
      .filter(
        (a) =>
          a.coa === coaHead &&
          a.category === category &&
          !rollupIds.has(a.id) &&
          a.subcategory !== a.category,
      )
      .sort((x, y) => x.subcategory.localeCompare(y.subcategory));
  }

  function update(idx: number, patch: Partial<LineRow>) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  const amounts = lines.map((l) => {
    const q = Number(l.quantity);
    const r = Number(l.rate);
    return Number.isFinite(q) && Number.isFinite(r) ? Math.round(q * r * 100) / 100 : 0;
  });
  const poValue = Math.round(amounts.reduce((s, a) => s + a, 0) * 100) / 100;
  const incomplete = lines.findIndex((l) => !l.coaHead || !l.category);
  const belowRequested = minPoValue - poValue > 0.005;

  const payload = lines.map((l) => ({
    coa_account_id: l.coa_account_id,
    coa: l.coaHead,
    category: l.category,
    quantity: Number(l.quantity) || 0,
    rate: Number(l.rate) || 0,
  }));

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:border-indigo-400 hover:text-indigo-700 dark:border-zinc-700 dark:text-zinc-300 dark:hover:text-indigo-300"
      >
        ✎ Edit PO / accounts
      </button>
    );
  }

  return (
    <form action={formAction} className="mt-3 rounded-lg border border-indigo-200 bg-indigo-50/40 p-3 dark:border-indigo-900 dark:bg-indigo-950/20">
      <input type="hidden" name="request_id" value={requestId} />
      <input type="hidden" name="line_items" value={JSON.stringify(payload)} />

      <p className="text-xs font-semibold text-indigo-900 dark:text-indigo-200">Edit PO breakdown</p>
      <p className="mt-0.5 text-[11px] text-indigo-900/70 dark:text-indigo-200/70">
        Possible while nothing is approved. Leave Subcategory blank to charge the whole category.
      </p>

      <div className="mt-3 space-y-3">
        {lines.map((line, idx) => {
          const subs = subOptionsFor(line.coaHead, line.category);
          return (
            <div key={line.key} className="rounded-md border border-zinc-200 bg-white p-2.5 dark:border-zinc-700 dark:bg-zinc-900">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                  Line {idx + 1}
                </span>
                <button
                  type="button"
                  onClick={() => setLines((p) => (p.length === 1 ? p : p.filter((_, i) => i !== idx)))}
                  disabled={lines.length === 1}
                  aria-label="Remove line"
                  className="rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30 dark:hover:bg-red-950/40"
                >
                  ✕
                </button>
              </div>
              <div className="mt-2 space-y-1.5">
                <Combobox
                  size="sm"
                  options={coaOptions}
                  value={line.coaHead}
                  onChange={(v) => update(idx, { coaHead: v, category: "", coa_account_id: "" })}
                  onClear={() => update(idx, { coaHead: "", category: "", coa_account_id: "" })}
                  placeholder="Search COA head…"
                  ariaLabel="COA head"
                />
                <Combobox
                  size="sm"
                  options={line.coaHead ? categoryOptionsFor(line.coaHead) : allCategoryOptions}
                  value={line.category}
                  onChange={(v) => pickCategory(idx, v)}
                  onClear={() => update(idx, { category: "", coa_account_id: "" })}
                  placeholder={line.coaHead ? "Search category…" : "Or search any category…"}
                  ariaLabel="Category"
                />
                <Combobox
                  size="sm"
                  options={
                    line.category
                      ? [
                          {
                            value: "",
                            label: subs.length
                              ? "Whole category (no subcategory)"
                              : "No subcategories — charges to category",
                          },
                          ...subs.map((sub) => ({ value: sub.id, label: sub.subcategory })),
                        ]
                      : allSubOptions
                  }
                  value={line.coa_account_id}
                  onChange={(v) => pickSubcategory(idx, v)}
                  // Only the subcategory goes; charging to the category is a
                  // valid state.
                  onClear={() => update(idx, { coa_account_id: "" })}
                  placeholder={line.category ? "Subcategory (optional)…" : "Or search any subcategory…"}
                  ariaLabel="Subcategory (optional)"
                />
              </div>
              <div className="mt-2 grid grid-cols-3 items-end gap-2">
                <label className="text-[11px] text-zinc-600 dark:text-zinc-400">
                  Qty
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.001"
                    min="0"
                    value={line.quantity}
                    onChange={(e) => update(idx, { quantity: e.target.value })}
                    className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2 py-1 text-right font-mono text-xs tabular-nums dark:border-zinc-700 dark:bg-zinc-950"
                  />
                </label>
                <label className="text-[11px] text-zinc-600 dark:text-zinc-400">
                  Rate (₹)
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    value={line.rate}
                    onChange={(e) => update(idx, { rate: e.target.value })}
                    placeholder="0.00"
                    className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2 py-1 text-right font-mono text-xs tabular-nums dark:border-zinc-700 dark:bg-zinc-950"
                  />
                </label>
                <p className="pb-1 text-right font-mono text-xs font-semibold tabular-nums">
                  {formatINR(amounts[idx])}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => setLines((p) => [...p, blankLine()])}
        className="mt-2 rounded-md border border-dashed border-indigo-400 px-3 py-1 text-xs font-medium text-indigo-700 dark:border-indigo-800 dark:text-indigo-300"
      >
        + Add line
      </button>

      <div className="mt-3 flex items-baseline justify-between border-t border-indigo-200 pt-2 dark:border-indigo-900">
        <span className="text-xs font-semibold uppercase tracking-wide text-indigo-800 dark:text-indigo-200">
          New PO value
        </span>
        <span className="font-mono text-sm font-semibold tabular-nums text-indigo-900 dark:text-indigo-100">
          {formatINR(poValue)}
        </span>
      </div>

      {incomplete !== -1 && (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
          Line {incomplete + 1}: pick a COA head and a category.
        </p>
      )}
      {belowRequested && (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
          Already requested {formatINR(minPoValue)} — the PO can&rsquo;t be lower than that.
        </p>
      )}
      {state?.error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{state.error}</p>}

      <div className="mt-3 flex gap-2">
        <button
          type="submit"
          disabled={pending || incomplete !== -1 || belowRequested || poValue <= 0}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save PO"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function blankLine(): LineRow {
  return {
    key: Math.random().toString(36).slice(2),
    coaHead: "",
    category: "",
    coa_account_id: "",
    quantity: "1",
    rate: "",
  };
}
