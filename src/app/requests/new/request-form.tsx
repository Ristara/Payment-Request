"use client";

import { useActionState, useMemo, useState } from "react";
import { createRequest } from "@/app/requests/actions";

type Vendor = { id: string; name: string; gstin: string | null; status: string };
type Outlet = { id: string; code: string; name: string };
type CoaAccount = { id: string; code: number; subcategory: string; category: string; coa: string };

export default function RequestForm({
  vendors,
  outlets,
  coaAccounts,
}: {
  vendors: Vendor[];
  outlets: Outlet[];
  coaAccounts: CoaAccount[];
}) {
  const [state, formAction, pending] = useActionState(createRequest, undefined);

  // Client state for cascading + auto-fills
  const [totalBill, setTotalBill] = useState("");
  const [prevPayments, setPrevPayments] = useState("");
  const [percent, setPercent] = useState("");
  const [amount, setAmount] = useState("");
  const [coaAccountId, setCoaAccountId] = useState("");
  const [supply, setSupply] = useState<"material" | "service" | "mixed" | "">("");
  const [materialPct, setMaterialPct] = useState("");
  const [servicePct, setServicePct] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [outletId, setOutletId] = useState("");
  const [poNa, setPoNa] = useState(false);

  const selectedCoa = useMemo(
    () => coaAccounts.find((c) => c.id === coaAccountId),
    [coaAccountId, coaAccounts],
  );
  const selectedVendor = vendors.find((v) => v.id === vendorId);

  // Auto-calc from % or explicit amount
  function onPercentChange(v: string) {
    setPercent(v);
    const p = Number(v);
    const t = Number(totalBill);
    if (p && t) setAmount((t * (p / 100)).toFixed(2));
  }
  function onTotalChange(v: string) {
    setTotalBill(v);
    const p = Number(percent);
    const t = Number(v);
    if (p && t) setAmount((t * (p / 100)).toFixed(2));
  }
  function onAmountChange(v: string) {
    setAmount(v);
    setPercent(""); // clear % if user typed a direct amount
  }

  const balance = (() => {
    const t = Number(totalBill);
    const p = Number(prevPayments) || 0;
    const a = Number(amount) || 0;
    if (!t) return null;
    return t - p - a;
  })();

  return (
    <form
      action={formAction}
      className="space-y-6 rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900"
    >
      {/* Vendor */}
      <section>
        <SectionTitle>Vendor</SectionTitle>
        <select
          name="vendor_id"
          value={vendorId}
          onChange={(e) => setVendorId(e.target.value)}
          required
          className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        >
          <option value="" disabled>
            Pick a vendor…
          </option>
          {vendors.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name} {v.status === "pending" ? "(pending approval)" : ""}
            </option>
          ))}
        </select>
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

      {/* Outlet — single select */}
      <section>
        <SectionTitle>Outlet</SectionTitle>
        <select
          name="outlet_ids"
          value={outletId}
          onChange={(e) => setOutletId(e.target.value)}
          required
          className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        >
          <option value="" disabled>
            Pick an outlet…
          </option>
          {outlets.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        {outlets.length === 0 && (
          <p className="mt-2 text-xs text-zinc-500">
            No outlets yet. Ask your admin to add one.
          </p>
        )}
      </section>

      {/* PO + Invoice ref */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <SectionTitle>PO number</SectionTitle>
          <input
            name="po_number"
            disabled={poNa}
            placeholder="PO-2026-045"
            className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm disabled:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:disabled:bg-zinc-800"
          />
          <label className="mt-2 flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
            <input type="checkbox" checked={poNa} onChange={(e) => setPoNa(e.target.checked)} />
            No PO applicable
          </label>
          {poNa && (
            <input
              name="po_not_applicable_reason"
              required
              placeholder="Reason…"
              className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
          )}
        </div>
        <div>
          <SectionTitle>Invoice / proforma reference (optional)</SectionTitle>
          <input
            name="invoice_reference"
            placeholder="INV-2026-045"
            className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </div>
      </section>

      {/* Money */}
      <section>
        <SectionTitle>Amount</SectionTitle>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <div>
            <label className="text-xs text-zinc-600 dark:text-zinc-400">Total bill (₹)</label>
            <input
              name="total_bill_value"
              type="number"
              step="0.01"
              min="0"
              required
              value={totalBill}
              onChange={(e) => onTotalChange(e.target.value)}
              className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
          </div>
          <div>
            <label className="text-xs text-zinc-600 dark:text-zinc-400">Previous paid (₹)</label>
            <input
              name="previous_payments"
              type="number"
              step="0.01"
              min="0"
              value={prevPayments}
              onChange={(e) => setPrevPayments(e.target.value)}
              className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
          </div>
          <div>
            <label className="text-xs text-zinc-600 dark:text-zinc-400">% requested</label>
            <input
              name="payment_percentage"
              type="number"
              step="0.01"
              min="0"
              max="100"
              value={percent}
              onChange={(e) => onPercentChange(e.target.value)}
              className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
          </div>
          <div>
            <label className="text-xs text-zinc-600 dark:text-zinc-400">This payment (₹)</label>
            <input
              name="payment_amount"
              type="number"
              step="0.01"
              min="0"
              required
              value={amount}
              onChange={(e) => onAmountChange(e.target.value)}
              className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium dark:border-zinc-700 dark:bg-zinc-900"
            />
          </div>
        </div>
        {balance !== null && (
          <p className="mt-2 text-xs text-zinc-500 tabular-nums">
            Balance payable after this: <strong>₹{balance.toFixed(2)}</strong>
          </p>
        )}
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
          <SectionTitle>Tentative invoice date</SectionTitle>
          <input
            name="tentative_invoice_date"
            type="date"
            className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </div>
      </section>

      {/* Subcategory (Category + COA + code auto-fill from it) */}
      <section>
        <SectionTitle>Classification</SectionTitle>
        <p className="mt-1 text-xs text-zinc-500">
          Pick a subcategory. The category, COA, and code fill in automatically.
        </p>
        <select
          name="coa_account_id"
          required
          value={coaAccountId}
          onChange={(e) => setCoaAccountId(e.target.value)}
          className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        >
          <option value="" disabled>Pick a subcategory…</option>
          {coaAccounts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.subcategory} — {c.category} ({c.code})
            </option>
          ))}
        </select>

        {selectedCoa && (
          <div className="mt-3 grid grid-cols-1 gap-3 rounded-md border border-dashed border-zinc-300 bg-zinc-50 p-3 text-sm sm:grid-cols-3 dark:border-zinc-700 dark:bg-zinc-900/50">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-zinc-500">Category</p>
              <p className="mt-0.5 text-xs text-zinc-800 dark:text-zinc-200">{selectedCoa.category}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-zinc-500">COA</p>
              <p className="mt-0.5 text-xs text-zinc-800 dark:text-zinc-200">{selectedCoa.coa}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-zinc-500">Code</p>
              <p className="mt-0.5 font-mono text-xs text-zinc-800 dark:text-zinc-200">{selectedCoa.code}</p>
            </div>
          </div>
        )}
      </section>

      {/* Supply composition */}
      <section>
        <SectionTitle>Supply composition</SectionTitle>
        <div className="mt-2 flex flex-wrap gap-2">
          {(["material", "service", "mixed"] as const).map((s) => (
            <label
              key={s}
              className={`cursor-pointer rounded-md border px-3 py-1.5 text-xs ${
                supply === s
                  ? "border-indigo-600 bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-200"
                  : "border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              }`}
            >
              <input
                type="radio"
                name="supply_composition"
                value={s}
                checked={supply === s}
                onChange={() => setSupply(s)}
                className="sr-only"
                required
              />
              {s === "material" ? "100% Material" : s === "service" ? "100% Service" : "Mixed"}
            </label>
          ))}
        </div>
        {supply === "mixed" && (
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-zinc-600 dark:text-zinc-400">Material %</label>
              <input
                name="material_percentage"
                type="number"
                step="0.01"
                min="0"
                max="100"
                value={materialPct}
                onChange={(e) => setMaterialPct(e.target.value)}
                className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-600 dark:text-zinc-400">Service %</label>
              <input
                name="service_percentage"
                type="number"
                step="0.01"
                min="0"
                max="100"
                value={servicePct}
                onChange={(e) => setServicePct(e.target.value)}
                className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              />
            </div>
          </div>
        )}
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

      {/* Cost centre + Attachments */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <SectionTitle>Cost centre (optional)</SectionTitle>
          <input
            name="cost_centre"
            placeholder="CC-HSR"
            className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </div>
        <div>
          <SectionTitle>Supporting documents</SectionTitle>
          <input
            type="file"
            name="attachments"
            multiple
            accept="image/*,application/pdf"
            className="mt-2 block w-full text-sm text-zinc-700 file:mr-3 file:rounded-md file:border-0 file:bg-indigo-50 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-indigo-700 hover:file:bg-indigo-100 dark:text-zinc-300"
          />
        </div>
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
