"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { createThread } from "@/app/requests/actions";
import Combobox, { type ComboOption } from "@/components/Combobox";
import { computeRollupIds } from "@/lib/coa";
import { formatINR } from "@/lib/types";

type Vendor = { id: string; name: string; gstin: string | null; status: string };
type Outlet = { id: string; code: string; name: string; stage: "upcoming" | "operational" };
type CoaAccount = { id: string; code: number; subcategory: string; category: string; coa: string };

type LineRow = {
  key: string;
  categoryKey: string; // JSON.stringify([coa, category]) — "" = none
  coa_account_id: string; // subcategory row — optional; empty = category-level
  quantity: string;
  rate: string;
};


function newLine(): LineRow {
  return {
    key: Math.random().toString(36).slice(2),
    categoryKey: "",
    coa_account_id: "",
    quantity: "1",
    rate: "",
  };
}

/**
 * First-time raise form. Creates a THREAD (payment_requests row) + its
 * first installment. Line items = the PO value; the "This installment"
 * box is the first release ask.
 *
 * Subsequent installments (2nd, 3rd, …) are raised from the thread's
 * detail page, not here.
 */
type Person = { id: string; full_name: string; email: string };

export default function RequestForm({
  vendors,
  outlets,
  coaAccounts,
  reservedNumber,
  people,
}: {
  vendors: Vendor[];
  outlets: Outlet[];
  coaAccounts: CoaAccount[];
  reservedNumber: string | null;
  people: Person[];
}) {
  const [state, formAction, pending] = useActionState(createThread, undefined);

  const [installmentAmount, setInstallmentAmount] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [outletId, setOutletId] = useState("");
  // "New Store Opening" → upcoming outlets; "Existing Outlet" → operational.
  const [storeType, setStoreType] = useState<"" | "upcoming" | "operational">("");
  const visibleOutlets = storeType ? outlets.filter((o) => o.stage === storeType) : [];
  const [paymentKind, setPaymentKind] = useState<"" | "regular" | "milestone">("");
  const [docType, setDocType] = useState<"" | "po" | "invoice" | "no_invoice" | "invoice_pending">("");
  const [docRef, setDocRef] = useState("");
  const [tentativeInvoice, setTentativeInvoice] = useState("");
  const [lines, setLines] = useState<LineRow[]>([newLine()]);
  const [ccIds, setCcIds] = useState<string[]>([]);
  const ccPeople = people.filter((p) => ccIds.includes(p.id));

  const refEnabled = docType === "po" || docType === "invoice";
  const refLabel = docType === "po" ? "PO number" : docType === "invoice" ? "Invoice number" : "Document number";
  const refPlaceholder =
    docType === "po" ? "PO-2026-045" : docType === "invoice" ? "INV-2026-045" : "";
  const tentativeEnabled = docType === "po" || docType === "invoice_pending";

  const selectedVendor = vendors.find((v) => v.id === vendorId);

  const rollupIds = useMemo(() => computeRollupIds(coaAccounts), [coaAccounts]);

  // Distinct (coa, category) pairs. The <option> value is the pair encoded as
  // a JSON array — printable characters round-trip HTML serialization safely
  // (a NUL-separator variant did not), and name-based values stay stable if
  // the CoA list refreshes underneath an open form (indexes would remap).
  const categoryGroups = useMemo(() => {
    const byCoa = new Map<string, Set<string>>();
    for (const a of coaAccounts) {
      let set = byCoa.get(a.coa);
      if (!set) {
        set = new Set();
        byCoa.set(a.coa, set);
      }
      set.add(a.category);
    }
    return [...byCoa.keys()].sort((a, b) => a.localeCompare(b)).map((coa) => ({
      coa,
      categories: [...(byCoa.get(coa) ?? [])].sort((a, b) => a.localeCompare(b)).map((category) => ({
        category,
        pairKey: JSON.stringify([coa, category]),
      })),
    }));
  }, [coaAccounts]);

  function parsePairKey(key: string): { coa: string; category: string } | null {
    if (!key) return null;
    try {
      const [coa, category] = JSON.parse(key) as [string, string];
      return typeof coa === "string" && typeof category === "string" ? { coa, category } : null;
    } catch {
      return null;
    }
  }

  // Real spendable subcategories inside a category. Rollup anchors and the
  // category's self-named row are excluded — that level is reached by leaving
  // Subcategory blank (the server charges the category itself).
  function subOptionsFor(categoryKey: string) {
    const cat = parsePairKey(categoryKey);
    if (!cat) return [];
    return coaAccounts
      .filter(
        (a) =>
          a.coa === cat.coa &&
          a.category === cat.category &&
          !rollupIds.has(a.id) &&
          a.subcategory !== a.category,
      )
      .sort((x, y) => x.subcategory.localeCompare(y.subcategory));
  }

  function updateLine(idx: number, patch: Partial<LineRow>) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLines((prev) => [...prev, newLine()]);
  }
  function removeLine(idx: number) {
    setLines((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== idx)));
  }

  const lineAmounts = lines.map((l) => {
    const q = Number(l.quantity);
    const r = Number(l.rate);
    return Number.isFinite(q) && Number.isFinite(r) ? Math.round(q * r * 100) / 100 : 0;
  });
  const poValue = Math.round(lineAmounts.reduce((s, a) => s + a, 0) * 100) / 100;

  const installmentNum = Number(installmentAmount) || 0;
  const balanceAfter = Math.max(0, Math.round((poValue - installmentNum) * 100) / 100);
  const pctOfPo = poValue > 0 && installmentNum > 0 ? (installmentNum / poValue) * 100 : null;
  const overPo = installmentNum > poValue + 0.01;

  // The server resolves category-level lines (no subcategory picked) from the
  // (coa, category) pair — the client never guesses the anchor row id.
  const linesPayload = lines.map((l) => {
    const cat = parsePairKey(l.categoryKey);
    return {
      coa_account_id: l.coa_account_id,
      coa: cat?.coa ?? "",
      category: cat?.category ?? "",
      quantity: Number(l.quantity) || 0,
      rate: Number(l.rate) || 0,
    };
  });

  return (
    <form
      action={formAction}
      className="space-y-6 rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900"
    >
      {reservedNumber && (
        <input type="hidden" name="request_number" value={reservedNumber} />
      )}

      {/* Expense type — CapEx is live; OpEx is a future module */}
      <section>
        <SectionTitle>Expense type</SectionTitle>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <div
            aria-pressed="true"
            className="rounded-xl border border-indigo-600 bg-indigo-50 px-3 py-2.5 text-center dark:border-indigo-400 dark:bg-indigo-950/40"
          >
            <span className="block text-sm font-semibold text-indigo-700 dark:text-indigo-200">
              CapEx
            </span>
            <span className="mt-0.5 block truncate text-[11px] text-zinc-500">
              Assets &amp; construction
            </span>
          </div>
          <div
            aria-disabled="true"
            title="OpEx module is coming soon"
            className="relative cursor-not-allowed rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-center opacity-60 dark:border-zinc-700 dark:bg-zinc-900"
          >
            <span className="absolute right-1.5 top-1.5 rounded-full bg-zinc-200 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wide text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
              Soon
            </span>
            <span className="block text-sm font-semibold text-zinc-500 dark:text-zinc-400">
              OpEx
            </span>
            <span className="mt-0.5 block truncate text-[11px] text-zinc-400">
              Rent &amp; utilities
            </span>
          </div>
        </div>
      </section>

      {/* Store type — decides which outlets are offered below */}
      <section>
        <SectionTitle>What is this payment for?</SectionTitle>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {([
            { key: "upcoming", title: "New Store", hint: "Upcoming outlet" },
            { key: "operational", title: "Existing Outlet", hint: "Operational outlet" },
          ] as const).map((opt) => {
            const active = storeType === opt.key;
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => {
                  setStoreType(opt.key);
                  // Reset outlet if it doesn't belong to the newly chosen group.
                  const stillValid = outlets.some((o) => o.id === outletId && o.stage === opt.key);
                  if (!stillValid) setOutletId("");
                }}
                aria-pressed={active}
                className={`rounded-xl border px-3 py-2.5 text-center transition-colors ${
                  active
                    ? "border-indigo-600 bg-indigo-50 dark:border-indigo-400 dark:bg-indigo-950/40"
                    : "border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800/60"
                }`}
              >
                <span className={`block truncate text-sm font-semibold ${active ? "text-indigo-700 dark:text-indigo-200" : "text-zinc-900 dark:text-zinc-100"}`}>
                  {opt.title}
                </span>
                <span className="mt-0.5 block truncate text-[11px] text-zinc-500">{opt.hint}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Payment kind */}
      <section>
        <SectionTitle>Payment kind</SectionTitle>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {([
            { key: "regular", title: "Regular", hint: "One-off / part payments" },
            { key: "milestone", title: "Milestone", hint: "Project milestones" },
          ] as const).map((opt) => {
            const active = paymentKind === opt.key;
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => setPaymentKind(opt.key)}
                aria-pressed={active}
                className={`rounded-xl border px-3 py-2.5 text-center transition-colors ${
                  active
                    ? "border-indigo-600 bg-indigo-50 dark:border-indigo-400 dark:bg-indigo-950/40"
                    : "border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800/60"
                }`}
              >
                <span className={`block truncate text-sm font-semibold ${active ? "text-indigo-700 dark:text-indigo-200" : "text-zinc-900 dark:text-zinc-100"}`}>
                  {opt.title}
                </span>
                <span className="mt-0.5 block truncate text-[11px] text-zinc-500">{opt.hint}</span>
              </button>
            );
          })}
        </div>
        <input type="hidden" name="payment_kind" value={paymentKind} />
      </section>

      {/* Outlet — filtered by the store-type choice above */}
      <section>
        <SectionTitle>Outlet</SectionTitle>
        <select
          name="outlet_ids"
          value={outletId}
          onChange={(e) => setOutletId(e.target.value)}
          required
          disabled={!storeType}
          className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:disabled:bg-zinc-800"
        >
          <option value="" disabled>
            {storeType ? "Pick an outlet…" : "Choose New Store / Existing Outlet first…"}
          </option>
          {visibleOutlets.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        {storeType && visibleOutlets.length === 0 && (
          <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
            No {storeType === "upcoming" ? "upcoming" : "operational"} outlets yet — ask your admin
            to mark one as {storeType === "upcoming" ? "Upcoming" : "Operational"} in Admin → Outlets.
          </p>
        )}
      </section>

      {/* Vendor */}
      <section>
        <SectionTitle>Vendor</SectionTitle>
        <div className="mt-2">
          <Combobox
            name="vendor_id"
            required
            value={vendorId}
            onChange={setVendorId}
            placeholder="Search vendor by name or GSTIN…"
            ariaLabel="Vendor"
            options={vendors.map<ComboOption>((v) => ({
              value: v.id,
              label: v.status === "pending" ? `${v.name} (pending approval)` : v.name,
              hint: v.gstin ?? undefined,
            }))}
          />
        </div>
        {selectedVendor?.status === "pending" && (
          <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
            This vendor is still being verified by Accounts. You can submit, but payment
            will pause until vendor is approved.
          </p>
        )}
        {vendors.length === 0 && (
          <p className="mt-2 text-xs text-zinc-500">
            No vendors yet. <a href="/vendors/new" className="text-indigo-600 underline">Add one</a>.
          </p>
        )}
      </section>

      {/* Document */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <SectionTitle>Document type</SectionTitle>
          <select
            name="document_type"
            required
            value={docType}
            onChange={(e) => {
              const v = e.target.value as typeof docType;
              setDocType(v);
              if (v === "no_invoice" || v === "invoice_pending") setDocRef("");
              if (v !== "po" && v !== "invoice_pending") setTentativeInvoice("");
            }}
            className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="" disabled>Pick document type…</option>
            <option value="po">PO</option>
            <option value="invoice">Invoice</option>
            <option value="no_invoice">No Invoice</option>
            <option value="invoice_pending">Invoice Yet to Receive</option>
          </select>
        </div>
        <div>
          <SectionTitle>{refLabel}{refEnabled ? " *" : ""}</SectionTitle>
          <input
            name="document_reference"
            value={docRef}
            onChange={(e) => setDocRef(e.target.value)}
            required={refEnabled}
            disabled={!refEnabled}
            placeholder={refEnabled ? refPlaceholder : "—"}
            className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:disabled:bg-zinc-800"
          />
        </div>
      </section>

      {/* Line items = PO breakdown */}
      <section>
        <div className="flex items-baseline justify-between">
          <SectionTitle>Line items</SectionTitle>
          <p className="hidden text-xs text-zinc-500 sm:block">Sum of lines = PO value.</p>
        </div>

        {/* Desktop table */}
        <div className="mt-3 hidden sm:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-[11px] uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
                <th className="px-2 py-2 font-medium">Category / Subcategory</th>
                <th className="px-2 py-2 text-right font-medium w-24">Qty</th>
                <th className="px-2 py-2 text-right font-medium w-32">Rate (₹)</th>
                <th className="px-2 py-2 text-right font-medium w-32">Amount</th>
                <th className="px-1 py-2 w-8" />
              </tr>
            </thead>
            <tbody>
              {lines.map((line, idx) => {
                const subs = subOptionsFor(line.categoryKey);
                return (
                  <tr key={line.key} className="border-b border-zinc-100 align-top dark:border-zinc-800/60">
                    <td className="px-1 py-2">
                      <div className="space-y-1.5">
                        <select
                          value={line.categoryKey}
                          onChange={(e) =>
                            updateLine(idx, { categoryKey: e.target.value, coa_account_id: "" })
                          }
                          required
                          aria-label="Category"
                          className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                        >
                          <option value="" disabled>
                            Pick category…
                          </option>
                          {categoryGroups.map((g) => (
                            <optgroup key={g.coa} label={g.coa}>
                              {g.categories.map((c) => (
                                <option key={c.category} value={c.pairKey}>
                                  {c.category}
                                </option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                        <select
                          value={line.coa_account_id}
                          onChange={(e) => updateLine(idx, { coa_account_id: e.target.value })}
                          disabled={!line.categoryKey}
                          aria-label="Subcategory (optional)"
                          className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs disabled:cursor-not-allowed disabled:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:disabled:bg-zinc-800"
                        >
                          <option value="">
                            {!line.categoryKey
                              ? "Pick category first…"
                              : subs.length
                                ? "Whole category (no subcategory)"
                                : "No subcategories — charges to category"}
                          </option>
                          {subs.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.subcategory}
                            </option>
                          ))}
                        </select>
                      </div>
                    </td>
                    <td className="px-1 py-2">
                      <input
                        type="number"
                        step="0.001"
                        min="0"
                        value={line.quantity}
                        onChange={(e) => updateLine(idx, { quantity: e.target.value })}
                        required
                        className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-right font-mono text-xs tabular-nums dark:border-zinc-700 dark:bg-zinc-900"
                      />
                    </td>
                    <td className="px-1 py-2">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={line.rate}
                        onChange={(e) => updateLine(idx, { rate: e.target.value })}
                        required
                        placeholder="0.00"
                        className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-right font-mono text-xs tabular-nums dark:border-zinc-700 dark:bg-zinc-900"
                      />
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-xs font-semibold tabular-nums">
                      {formatINR(lineAmounts[idx])}
                    </td>
                    <td className="px-1 py-2 text-center">
                      <button
                        type="button"
                        onClick={() => removeLine(idx)}
                        disabled={lines.length === 1}
                        aria-label="Remove line"
                        className="rounded-md p-1 text-zinc-400 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-red-950/40"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3} className="px-2 pt-3 text-right text-xs uppercase tracking-wide text-zinc-500">
                  PO value
                </td>
                <td className="px-2 pt-3 text-right font-mono text-sm font-semibold text-zinc-900 tabular-nums dark:text-zinc-100">
                  {formatINR(poValue)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Mobile stacked cards */}
        <div className="mt-3 space-y-3 sm:hidden">
          {lines.map((line, idx) => {
            const subs = subOptionsFor(line.categoryKey);
            return (
              <div
                key={line.key}
                className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/50"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                    Line {idx + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeLine(idx)}
                    disabled={lines.length === 1}
                    aria-label="Remove line"
                    className="rounded-md p-1 text-zinc-400 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-red-950/40"
                  >
                    ✕
                  </button>
                </div>
                <div className="mt-2">
                  <label className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">Category</label>
                  <select
                    value={line.categoryKey}
                    onChange={(e) =>
                      updateLine(idx, { categoryKey: e.target.value, coa_account_id: "" })
                    }
                    required
                    aria-label="Category"
                    className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                  >
                    <option value="" disabled>
                      Pick category…
                    </option>
                    {categoryGroups.map((g) => (
                      <optgroup key={g.coa} label={g.coa}>
                        {g.categories.map((c) => (
                          <option key={c.category} value={c.pairKey}>
                            {c.category}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>
                <div className="mt-2">
                  <label className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
                    Subcategory <span className="font-normal text-zinc-400">(optional)</span>
                  </label>
                  <select
                    value={line.coa_account_id}
                    onChange={(e) => updateLine(idx, { coa_account_id: e.target.value })}
                    disabled={!line.categoryKey}
                    aria-label="Subcategory (optional)"
                    className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2 py-2 text-sm disabled:cursor-not-allowed disabled:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:disabled:bg-zinc-800"
                  >
                    <option value="">
                      {!line.categoryKey
                        ? "Pick category first…"
                        : subs.length
                          ? "Whole category (no subcategory)"
                          : "No subcategories — charges to category"}
                    </option>
                    {subs.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.subcategory}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">Qty</label>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.001"
                      min="0"
                      value={line.quantity}
                      onChange={(e) => updateLine(idx, { quantity: e.target.value })}
                      required
                      className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-right font-mono text-sm tabular-nums dark:border-zinc-700 dark:bg-zinc-900"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">Rate (₹)</label>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min="0"
                      value={line.rate}
                      onChange={(e) => updateLine(idx, { rate: e.target.value })}
                      required
                      placeholder="0.00"
                      className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-right font-mono text-sm tabular-nums dark:border-zinc-700 dark:bg-zinc-900"
                    />
                  </div>
                </div>
                <div className="mt-3 flex items-baseline justify-between border-t border-zinc-200 pt-2 dark:border-zinc-800">
                  <span className="text-[11px] uppercase tracking-wide text-zinc-500">Amount</span>
                  <span className="font-mono text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                    {formatINR(lineAmounts[idx])}
                  </span>
                </div>
              </div>
            );
          })}

          <div className="flex items-baseline justify-between rounded-lg bg-indigo-50 px-3 py-2 dark:bg-indigo-950/40">
            <span className="text-xs font-semibold uppercase tracking-wide text-indigo-700 dark:text-indigo-200">
              PO value
            </span>
            <span className="font-mono text-base font-semibold tabular-nums text-indigo-900 dark:text-indigo-100">
              {formatINR(poValue)}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={addLine}
          className="mt-3 w-full rounded-md border border-dashed border-indigo-400 bg-indigo-50/50 px-3 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-50 sm:w-auto sm:px-3 sm:py-1.5 sm:text-xs dark:border-indigo-800 dark:bg-indigo-950/30 dark:text-indigo-300"
        >
          + Add another line
        </button>

        {/* Hidden fields carrying the payload */}
        <input type="hidden" name="line_items" value={JSON.stringify(linesPayload)} />
      </section>

      {/* First installment box */}
      <section>
        <SectionTitle>First installment</SectionTitle>
        <p className="mt-1 text-xs text-zinc-500">
          How much are you asking to be released against this PO right now? You'll come back to
          this thread later to raise the next installment.
        </p>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label className="text-xs text-zinc-600 dark:text-zinc-400">
              This installment (₹) <span className="text-red-500">*</span>
            </label>
            <input
              name="installment_amount"
              type="number"
              step="0.01"
              min="0"
              required
              value={installmentAmount}
              onChange={(e) => setInstallmentAmount(e.target.value)}
              className={`mt-1 w-full rounded-md border bg-white px-3 py-2 text-sm dark:bg-zinc-900 ${
                overPo ? "border-red-400 dark:border-red-700" : "border-zinc-300 dark:border-zinc-700"
              }`}
            />
            {pctOfPo !== null && !overPo && (
              <p className="mt-1 text-[11px] text-zinc-500 tabular-nums">
                {pctOfPo.toFixed(1)}% of PO value
              </p>
            )}
            {overPo && (
              <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">
                Exceeds PO value ({formatINR(poValue)}).
              </p>
            )}
          </div>
          <div>
            <label className="text-xs text-zinc-600 dark:text-zinc-400">Previous paid (₹)</label>
            <div className="mt-1 w-full rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-right font-mono text-sm tabular-nums text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950">
              ₹0.00
            </div>
            <p className="mt-1 text-[11px] text-zinc-500">
              First installment on this thread — nothing paid yet.
            </p>
          </div>
          <div>
            <label className="text-xs text-zinc-600 dark:text-zinc-400">Balance after (auto)</label>
            <div className="mt-1 w-full rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-right font-mono text-sm font-semibold tabular-nums text-zinc-800 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100">
              {formatINR(balanceAfter)}
            </div>
            <p className="mt-1 text-[11px] text-zinc-500">Remains on PO after this installment.</p>
          </div>
        </div>
      </section>

      {/* Dates */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <SectionTitle>Payment due date</SectionTitle>
          <input
            name="payment_due_date"
            type="date"
            required
            className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </div>
        <div>
          <SectionTitle>Work completion date</SectionTitle>
          <input
            name="date_of_work_completion"
            type="date"
            className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </div>
        <div>
          <SectionTitle>Tentative invoice date{tentativeEnabled ? " *" : ""}</SectionTitle>
          <input
            name="tentative_invoice_date"
            type="date"
            value={tentativeInvoice}
            onChange={(e) => setTentativeInvoice(e.target.value)}
            required={tentativeEnabled}
            disabled={!tentativeEnabled}
            className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:disabled:bg-zinc-800"
          />
          {!tentativeEnabled && docType && (
            <p className="mt-1 text-[11px] text-zinc-500">
              Not needed — invoice is {docType === "invoice" ? "already attached" : "not applicable"}.
            </p>
          )}
        </div>
      </section>

      {/* Purpose */}
      <section>
        <SectionTitle>Purpose / description</SectionTitle>
        <textarea
          name="purpose"
          required
          rows={3}
          placeholder="Business justification, scope of work, period covered…"
          className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
      </section>

      {/* CC — loop people in for visibility */}
      <section>
        <SectionTitle>CC (optional)</SectionTitle>
        <p className="mt-1 text-xs text-zinc-500">
          Loop in anyone who should be informed about this payment. They can view the
          thread and get notified, but don&apos;t need to act.
        </p>
        <div className="mt-2">
          <Combobox
            value=""
            onChange={(id) => {
              if (id) setCcIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
            }}
            placeholder="Search a person to CC…"
            ariaLabel="CC person"
            options={people
              .filter((p) => !ccIds.includes(p.id))
              .map<ComboOption>((p) => ({ value: p.id, label: p.full_name, hint: p.email }))}
          />
        </div>
        {ccPeople.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {ccPeople.map((p) => (
              <span
                key={p.id}
                className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2.5 py-1 text-xs font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-200"
              >
                {p.full_name}
                <button
                  type="button"
                  onClick={() => setCcIds((prev) => prev.filter((x) => x !== p.id))}
                  aria-label={`Remove ${p.full_name} from CC`}
                  className="text-indigo-500 hover:text-indigo-800"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <input type="hidden" name="cc_user_ids" value={JSON.stringify(ccIds)} />
      </section>

      {/* Supporting documents — Zoho Expense-style drop zone with previews */}
      <section>
        <SectionTitle>Supporting documents</SectionTitle>
        <AttachmentsField />
      </section>

      {state?.error && (
        <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>
      )}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-indigo-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {pending ? "Submitting…" : "Submit for approval"}
        </button>
      </div>
    </form>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{children}</h2>
  );
}

function AttachmentsField() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!inputRef.current) return;
    const dt = new DataTransfer();
    files.forEach((f) => dt.items.add(f));
    inputRef.current.files = dt.files;
  }, [files]);

  function addFiles(incoming: FileList | File[] | null | undefined) {
    if (!incoming) return;
    const arr = Array.from(incoming);
    if (!arr.length) return;
    setFiles((prev) => {
      const key = (f: File) => `${f.name}|${f.size}|${f.lastModified}`;
      const seen = new Set(prev.map(key));
      const merged = [...prev];
      for (const f of arr) if (!seen.has(key(f))) merged.push(f);
      return merged;
    });
  }
  function removeAt(idx: number) {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  const totalSize = files.reduce((s, f) => s + f.size, 0);

  return (
    <div className="mt-2">
      <label
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors ${
          dragging
            ? "border-indigo-500 bg-indigo-50 dark:border-indigo-400 dark:bg-indigo-950/40"
            : "border-zinc-300 bg-zinc-50 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900/40 dark:hover:bg-zinc-800/40"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          name="attachments"
          multiple
          accept="image/*,application/pdf"
          onChange={(e) => addFiles(e.target.files)}
          className="sr-only"
        />
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-100 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-300">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3v12" />
            <path d="M7 8l5-5 5 5" />
            <path d="M5 21h14" />
          </svg>
        </div>
        <p className="mt-2 text-sm font-medium text-zinc-800 dark:text-zinc-100">
          <span className="text-indigo-600 dark:text-indigo-300">Click to upload</span> or drag &amp; drop
        </p>
        <p className="mt-0.5 text-[11px] text-zinc-500">
          Images (PNG · JPG) or PDF · up to 10 MB each
        </p>
      </label>

      {files.length > 0 && (
        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-between px-1 text-[11px] text-zinc-500">
            <span>{files.length} file{files.length === 1 ? "" : "s"}</span>
            <span className="tabular-nums">Total {formatBytes(totalSize)}</span>
          </div>
          <ul className="space-y-2">
            {files.map((f, i) => (
              <FileCard key={`${f.name}-${f.lastModified}-${i}`} file={f} onRemove={() => removeAt(i)} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function FileCard({ file, onRemove }: { file: File; onRemove: () => void }) {
  const [thumb, setThumb] = useState<string | null>(null);
  const isImage = file.type.startsWith("image/");
  useEffect(() => {
    if (!isImage) return;
    const url = URL.createObjectURL(file);
    setThumb(url);
    return () => URL.revokeObjectURL(url);
  }, [file, isImage]);
  return (
    <li className="flex items-center gap-3 rounded-lg border border-zinc-200 bg-white p-2 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex h-12 w-12 flex-none items-center justify-center overflow-hidden rounded-md bg-zinc-100 dark:bg-zinc-800">
        {isImage && thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumb} alt={file.name} className="h-full w-full object-cover" />
        ) : (
          <span className="text-xs font-bold text-red-600">PDF</span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">{file.name}</p>
        <p className="text-[11px] text-zinc-500 tabular-nums">{formatBytes(file.size)}</p>
      </div>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${file.name}`}
        className="flex h-8 w-8 flex-none items-center justify-center rounded-md text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
      >
        ✕
      </button>
    </li>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
