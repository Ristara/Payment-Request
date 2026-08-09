"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useState } from "react";
import { createProcurementRequest } from "@/app/procurement/actions";
import { formatINR } from "@/lib/types";

export type OutletOption = { id: string; name: string };
export type VendorOption = { id: string; name: string };

type Line = { description: string; quantity: string; rate: string };

const FIELD =
  "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-950";

export default function ProcurementForm({
  outlets,
  vendors,
  reservedNumber,
}: {
  outlets: OutletOption[];
  vendors: VendorOption[];
  reservedNumber: string | null;
}) {
  const [state, action, pending] = useActionState(createProcurementRequest, undefined);
  const router = useRouter();

  const [lines, setLines] = useState<Line[]>([{ description: "", quantity: "1", rate: "" }]);
  const [instalments, setInstalments] = useState<string[]>([]);
  const [docType, setDocType] = useState("");

  const lineTotal = lines.reduce(
    (sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.rate) || 0),
    0,
  );
  const instTotal = instalments.reduce((sum, a) => sum + (Number(a) || 0), 0);
  // Shown live rather than only rejected on submit — a mismatch you find out
  // about after clicking is a mismatch you have to hunt for.
  const mismatch =
    instalments.length > 0 && lines.some((l) => l.description.trim())
      ? Math.abs(instTotal - lineTotal) > 0.5
      : false;

  const setLine = (i: number, patch: Partial<Line>) =>
    setLines((prev) => prev.map((l, n) => (n === i ? { ...l, ...patch } : l)));

  // Straight to the list on success. Leaving the filled form on screen invites
  // a second click and a duplicate request.
  useEffect(() => {
    if (state?.info) router.push("/procurement");
  }, [state?.info, router]);

  return (
    <form action={action} className="mt-6 space-y-5">
      {reservedNumber && (
        <p className="text-xs text-zinc-500">
          This will be <span className="font-mono font-medium">{reservedNumber}</span>
        </p>
      )}

      <div>
        <label htmlFor="title" className="mb-1 block text-sm font-medium">
          What do you need? <span className="text-red-600">*</span>
        </label>
        <input id="title" name="title" required maxLength={140} className={FIELD}
          placeholder="e.g. Deep freezer repair, 20 dining chairs" />
      </div>

      <div>
        <label htmlFor="description" className="mb-1 block text-sm font-medium">
          Details <span className="text-red-600">*</span>
        </label>
        <textarea id="description" name="description" required rows={4} maxLength={2000} className={FIELD}
          placeholder="What is wrong, or what exactly is needed. Procurement will source against this." />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="payment_kind" className="mb-1 block text-sm font-medium">
            Payment kind <span className="text-red-600">*</span>
          </label>
          <select id="payment_kind" name="payment_kind" defaultValue="regular" className={FIELD}>
            <option value="regular">Regular — one-off / part payments</option>
            <option value="milestone">Milestone — project milestones</option>
          </select>
        </div>

        <div>
          <label htmlFor="vendor_id" className="mb-1 block text-sm font-medium">Vendor</label>
          <select id="vendor_id" name="vendor_id" defaultValue="" className={FIELD}>
            <option value="">Not decided yet</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>
          {/* Optional on purpose. Not having a vendor yet is the usual reason
              for raising one of these at all. */}
          <p className="mt-1 text-xs text-zinc-500">Leave blank if you haven&rsquo;t picked one.</p>
        </div>

        <div>
          <label htmlFor="document_type" className="mb-1 block text-sm font-medium">Document</label>
          <select
            id="document_type"
            name="document_type"
            value={docType}
            onChange={(e) => setDocType(e.target.value)}
            className={FIELD}
          >
            <option value="">None yet</option>
            <option value="quotation">Quotation</option>
            <option value="proforma">Proforma invoice</option>
            <option value="estimate">Estimate</option>
          </select>
        </div>

        <div>
          <label htmlFor="document_reference" className="mb-1 block text-sm font-medium">
            Document number
          </label>
          <input
            id="document_reference"
            name="document_reference"
            disabled={docType === ""}
            placeholder={docType === "" ? "Pick a document first" : "e.g. QT-4471"}
            className={FIELD}
          />
        </div>

        <div>
          <label htmlFor="outlet_id" className="mb-1 block text-sm font-medium">
            Branch <span className="text-red-600">*</span>
          </label>
          <select id="outlet_id" name="outlet_id" required defaultValue="" className={FIELD}>
            <option value="" disabled>Choose a branch…</option>
            {outlets.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="expense_type" className="mb-1 block text-sm font-medium">
            Expense type <span className="text-red-600">*</span>
          </label>
          <select id="expense_type" name="expense_type" defaultValue="capex" className={FIELD}>
            <option value="capex">CapEx — assets &amp; construction</option>
            <option value="opex">OpEx — rent &amp; utilities</option>
          </select>
        </div>

        <div>
          <label htmlFor="priority" className="mb-1 block text-sm font-medium">Priority</label>
          <select id="priority" name="priority" defaultValue="normal" className={FIELD}>
            <option value="normal">Normal</option>
            <option value="urgent">Urgent</option>
          </select>
        </div>
      </div>

      {/* ---- Items ---------------------------------------------------- */}
      <section>
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-medium">What&rsquo;s needed</h2>
          <span className="text-sm font-semibold tabular-nums">{formatINR(lineTotal)}</span>
        </div>
        <div className="mt-2 space-y-2">
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-12 gap-2">
              <input
                name="line_description"
                value={l.description}
                onChange={(e) => setLine(i, { description: e.target.value })}
                placeholder="Item or work"
                aria-label={`Item ${i + 1} description`}
                className={`col-span-12 sm:col-span-6 ${FIELD}`}
              />
              <input
                name="line_quantity"
                value={l.quantity}
                onChange={(e) => setLine(i, { quantity: e.target.value.replace(/[^\d.]/g, "") })}
                inputMode="decimal"
                placeholder="Qty"
                aria-label={`Item ${i + 1} quantity`}
                className={`col-span-4 sm:col-span-2 ${FIELD}`}
              />
              <input
                name="line_rate"
                value={l.rate}
                onChange={(e) => setLine(i, { rate: e.target.value.replace(/[^\d.]/g, "") })}
                inputMode="decimal"
                placeholder="Rate"
                aria-label={`Item ${i + 1} rate`}
                className={`col-span-4 sm:col-span-2 ${FIELD}`}
              />
              {/* Read-only: the amount is quantity x rate, and letting someone
                  type a third number invites a row that contradicts itself. */}
              <div className="col-span-4 flex items-center justify-end px-2 text-sm tabular-nums text-zinc-600 sm:col-span-2 dark:text-zinc-300">
                {formatINR((Number(l.quantity) || 0) * (Number(l.rate) || 0))}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-2 flex gap-3 text-xs">
          <button
            type="button"
            onClick={() => setLines((p) => [...p, { description: "", quantity: "1", rate: "" }])}
            className="font-medium text-indigo-600 hover:underline dark:text-indigo-400"
          >
            + Add item
          </button>
          {lines.length > 1 && (
            <button
              type="button"
              onClick={() => setLines((p) => p.slice(0, -1))}
              className="text-zinc-500 hover:underline"
            >
              Remove last
            </button>
          )}
        </div>
      </section>

      {/* ---- Instalments ------------------------------------------------ */}
      <section>
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-medium">How it will be paid</h2>
          {instalments.length > 0 && (
            <span className={mismatch ? "text-sm font-semibold tabular-nums text-red-600" : "text-sm font-semibold tabular-nums"}>
              {formatINR(instTotal)}
            </span>
          )}
        </div>
        {/* No dates here, deliberately: the due date belongs to the payment
            request, once there is a PO to pay against. */}
        <p className="mt-1 text-xs text-zinc-500">
          Optional. Split the total if it will be paid in parts — dates come later,
          on the payment request.
        </p>
        {instalments.length > 0 && (
          <div className="mt-2 space-y-2">
            {instalments.map((a, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="w-6 shrink-0 text-xs text-zinc-500">#{i + 1}</span>
                <input
                  name="installment_amount"
                  value={a}
                  onChange={(e) => {
                    const v = e.target.value.replace(/[^\d.]/g, "");
                    setInstalments((p) => p.map((x, n) => (n === i ? v : x)));
                  }}
                  inputMode="decimal"
                  placeholder="Amount"
                  aria-label={`Instalment ${i + 1} amount`}
                  className={FIELD}
                />
              </div>
            ))}
          </div>
        )}
        <div className="mt-2 flex gap-3 text-xs">
          <button
            type="button"
            onClick={() => setInstalments((p) => [...p, ""])}
            className="font-medium text-indigo-600 hover:underline dark:text-indigo-400"
          >
            + Add instalment
          </button>
          {instalments.length > 0 && (
            <button
              type="button"
              onClick={() => setInstalments((p) => p.slice(0, -1))}
              className="text-zinc-500 hover:underline"
            >
              Remove last
            </button>
          )}
        </div>
        {mismatch && (
          <p className="mt-2 text-xs text-red-600 dark:text-red-400">
            The instalments come to {formatINR(instTotal)} but the items total{" "}
            {formatINR(lineTotal)}.
          </p>
        )}
      </section>

      {state?.error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {state.error}
        </p>
      )}

      <button
        disabled={pending}
        className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
      >
        {pending ? "Raising…" : "Raise procurement request"}
      </button>
    </form>
  );
}
