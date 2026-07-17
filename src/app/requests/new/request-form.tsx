"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { createRequest } from "@/app/requests/actions";
import Combobox, { type ComboOption } from "@/components/Combobox";
import HierarchicalPicker from "@/components/HierarchicalPicker";

type Vendor = { id: string; name: string; gstin: string | null; status: string };
type Outlet = { id: string; code: string; name: string };
type CoaAccount = { id: string; code: number; subcategory: string; category: string; coa: string };

type LineRow = {
  key: string;
  coa_account_id: string;
  quantity: string;
  rate: string;
};

function newLine(): LineRow {
  return {
    key: Math.random().toString(36).slice(2),
    coa_account_id: "",
    quantity: "1",
    rate: "",
  };
}

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

  const [totalBill, setTotalBill] = useState("");
  const [prevPayments, setPrevPayments] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [outletId, setOutletId] = useState("");
  const [docType, setDocType] = useState<"" | "po" | "invoice" | "no_invoice" | "invoice_pending">("");
  const [docRef, setDocRef] = useState("");
  const [tentativeInvoice, setTentativeInvoice] = useState("");
  const [lines, setLines] = useState<LineRow[]>([newLine()]);

  const refEnabled = docType === "po" || docType === "invoice";
  const refLabel = docType === "po" ? "PO number" : docType === "invoice" ? "Invoice number" : "Document number";
  const refPlaceholder =
    docType === "po" ? "PO-2026-045" : docType === "invoice" ? "INV-2026-045" : "";
  // Tentative invoice date is meaningful only when the invoice hasn't landed
  // yet — i.e. document type is PO or "Invoice yet to receive".
  const tentativeEnabled = docType === "po" || docType === "invoice_pending";

  const selectedVendor = vendors.find((v) => v.id === vendorId);

  const coaById = useMemo(() => {
    const m = new Map<string, CoaAccount>();
    coaAccounts.forEach((c) => m.set(c.id, c));
    return m;
  }, [coaAccounts]);

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
  const paymentAmount = Math.round(lineAmounts.reduce((s, a) => s + a, 0) * 100) / 100;

  const balance = (() => {
    const t = Number(totalBill);
    const p = Number(prevPayments) || 0;
    if (!t) return null;
    return Math.round((t - p - paymentAmount) * 100) / 100;
  })();

  const linesPayload = lines.map((l) => ({
    coa_account_id: l.coa_account_id,
    quantity: Number(l.quantity) || 0,
    rate: Number(l.rate) || 0,
  }));

  return (
    <form
      action={formAction}
      className="space-y-6 rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900"
    >
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

      {/* Supporting document */}
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
              // Wipe tentative date when it becomes irrelevant so the disabled
              // input never submits a stale value.
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

      {/* Line items — Zoho Bills style. Desktop: table row. Mobile: stacked card. */}
      <section>
        <div className="flex items-baseline justify-between">
          <SectionTitle>Line items</SectionTitle>
          <p className="hidden text-xs text-zinc-500 sm:block">Sum of lines = this payment amount.</p>
        </div>

        {/* Desktop table */}
        <div className="mt-3 hidden sm:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-[11px] uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
                <th className="px-2 py-2 font-medium">Subcategory</th>
                <th className="px-2 py-2 text-right font-medium w-24">Qty</th>
                <th className="px-2 py-2 text-right font-medium w-32">Rate (₹)</th>
                <th className="px-2 py-2 text-right font-medium w-32">Amount</th>
                <th className="px-1 py-2 w-8" />
              </tr>
            </thead>
            <tbody>
              {lines.map((line, idx) => {
                const coa = line.coa_account_id ? coaById.get(line.coa_account_id) : undefined;
                return (
                  <tr key={line.key} className="border-b border-zinc-100 align-top dark:border-zinc-800/60">
                    <td className="px-1 py-2">
                      <HierarchicalPicker
                        size="sm"
                        accounts={coaAccounts}
                        value={line.coa_account_id}
                        onChange={(v) => updateLine(idx, { coa_account_id: v })}
                        placeholder="Pick subcategory"
                        ariaLabel="Subcategory"
                      />
                      {coa && (
                        <p className="mt-1 text-[10px] text-zinc-500">
                          {coa.category} · {coa.coa}
                        </p>
                      )}
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
                      ₹{lineAmounts[idx].toFixed(2)}
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
                  Total
                </td>
                <td className="px-2 pt-3 text-right font-mono text-sm font-semibold text-zinc-900 tabular-nums dark:text-zinc-100">
                  ₹{paymentAmount.toFixed(2)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Mobile stacked cards */}
        <div className="mt-3 space-y-3 sm:hidden">
          {lines.map((line, idx) => {
            const coa = line.coa_account_id ? coaById.get(line.coa_account_id) : undefined;
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
                  <label className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
                    Subcategory
                  </label>
                  <div className="mt-1">
                    <HierarchicalPicker
                      accounts={coaAccounts}
                      value={line.coa_account_id}
                      onChange={(v) => updateLine(idx, { coa_account_id: v })}
                      placeholder="Pick subcategory"
                      ariaLabel="Subcategory"
                    />
                  </div>
                  {coa && (
                    <p className="mt-1 text-[10px] text-zinc-500">
                      {coa.category} · {coa.coa}
                    </p>
                  )}
                </div>

                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
                      Qty
                    </label>
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
                    <label className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
                      Rate (₹)
                    </label>
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
                    ₹{lineAmounts[idx].toFixed(2)}
                  </span>
                </div>
              </div>
            );
          })}

          <div className="flex items-baseline justify-between rounded-lg bg-indigo-50 px-3 py-2 dark:bg-indigo-950/40">
            <span className="text-xs font-semibold uppercase tracking-wide text-indigo-700 dark:text-indigo-200">
              Total
            </span>
            <span className="font-mono text-base font-semibold tabular-nums text-indigo-900 dark:text-indigo-100">
              ₹{paymentAmount.toFixed(2)}
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
        <input type="hidden" name="payment_amount" value={paymentAmount.toFixed(2)} />
      </section>

      {/* Bill totals context */}
      <section>
        <SectionTitle>Bill totals</SectionTitle>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label className="text-xs text-zinc-600 dark:text-zinc-400">Total bill value (₹)</label>
            <input
              name="total_bill_value"
              type="number"
              step="0.01"
              min="0"
              required
              value={totalBill}
              onChange={(e) => setTotalBill(e.target.value)}
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
            <label className="text-xs text-zinc-600 dark:text-zinc-400">This payment (auto)</label>
            <div className="mt-1 w-full rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-right font-mono text-sm font-semibold tabular-nums text-zinc-800 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100">
              ₹{paymentAmount.toFixed(2)}
            </div>
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
          <SectionTitle>
            Tentative invoice date{tentativeEnabled ? " *" : ""}
          </SectionTitle>
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

/**
 * Drop-zone attachment picker à la Zoho Expense.
 * - Dashed drop zone with an upload icon, click-or-drop, formats hint.
 * - Selected files show as cards: thumbnail for images, PDF icon otherwise,
 *   plus name, size, and a per-file remove button.
 * - Selection is a real File[] mirrored back into the hidden <input type=file>
 *   via DataTransfer, so it submits with the form as attachments[].
 */
function AttachmentsField() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);

  // Keep the input's FileList in sync with our state so the form submits it.
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
    // Dedup by name+size+lastModified — good enough for the common re-drop case.
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
      {/* Drop zone */}
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          addFiles(e.dataTransfer.files);
        }}
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

      {/* Selected files */}
      {files.length > 0 && (
        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-between px-1 text-[11px] text-zinc-500">
            <span>
              {files.length} file{files.length === 1 ? "" : "s"}
            </span>
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
