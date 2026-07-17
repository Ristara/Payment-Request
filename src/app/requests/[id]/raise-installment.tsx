"use client";

import { useActionState, useState } from "react";
import { raiseInstallment } from "@/app/requests/actions";
import { formatINR } from "@/lib/types";

/**
 * Mini form to raise the next installment against a thread's existing PO.
 * Only the amount + due date + a short note are required — vendor, doc,
 * and line items are already fixed on the thread.
 */
export default function RaiseInstallmentPanel({
  requestId,
  poValue,
  requestedTotal,
  balanceRemaining,
  nextInstallmentNumber,
}: {
  requestId: string;
  poValue: number;
  requestedTotal: number;
  balanceRemaining: number;
  nextInstallmentNumber: number;
}) {
  const [state, action, pending] = useActionState(raiseInstallment, undefined);
  const [amount, setAmount] = useState("");
  const [open, setOpen] = useState(false);

  const amt = Number(amount) || 0;
  const wouldExceed = amt > balanceRemaining + 0.005;
  const balanceAfter = Math.max(0, Math.round((balanceRemaining - amt) * 100) / 100);
  const pctOfPo = poValue > 0 && amt > 0 ? (amt / poValue) * 100 : null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-md border border-dashed border-indigo-400 bg-indigo-50/50 px-3 py-3 text-sm font-medium text-indigo-700 hover:bg-indigo-50 dark:border-indigo-800 dark:bg-indigo-950/30 dark:text-indigo-300"
      >
        + Raise installment #{nextInstallmentNumber} · {formatINR(balanceRemaining)} balance
      </button>
    );
  }

  return (
    <form action={action} className="rounded-lg border border-indigo-200 bg-indigo-50/40 p-4 dark:border-indigo-800 dark:bg-indigo-950/20">
      <div className="flex items-baseline justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700 dark:text-indigo-300">
          New installment #{nextInstallmentNumber}
        </p>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-zinc-500 hover:underline">
          Cancel
        </button>
      </div>

      <input type="hidden" name="request_id" value={requestId} />

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className="text-xs text-zinc-600 dark:text-zinc-400">
            This installment (₹) <span className="text-red-500">*</span>
          </label>
          <input
            name="requested_amount"
            type="number"
            step="0.01"
            min="0"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={`mt-1 w-full rounded-md border bg-white px-3 py-2 text-sm dark:bg-zinc-900 ${
              wouldExceed ? "border-red-400 dark:border-red-700" : "border-zinc-300 dark:border-zinc-700"
            }`}
          />
          {pctOfPo !== null && !wouldExceed && (
            <p className="mt-1 text-[11px] text-zinc-500 tabular-nums">
              {pctOfPo.toFixed(1)}% of PO value
            </p>
          )}
          {wouldExceed && (
            <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">
              Only {formatINR(balanceRemaining)} left on this PO.
            </p>
          )}
        </div>
        <div>
          <label className="text-xs text-zinc-600 dark:text-zinc-400">Already requested (₹)</label>
          <div className="mt-1 w-full rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-right font-mono text-sm tabular-nums text-zinc-800 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100">
            {formatINR(requestedTotal)}
          </div>
        </div>
        <div>
          <label className="text-xs text-zinc-600 dark:text-zinc-400">Balance after (auto)</label>
          <div className="mt-1 w-full rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-right font-mono text-sm font-semibold tabular-nums text-zinc-800 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100">
            {formatINR(balanceAfter)}
          </div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="text-xs text-zinc-600 dark:text-zinc-400">
            Payment due date <span className="text-red-500">*</span>
          </label>
          <input
            name="payment_due_date"
            type="date"
            required
            className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </div>
        <div>
          <label className="text-xs text-zinc-600 dark:text-zinc-400">Work completion date</label>
          <input
            name="date_of_work_completion"
            type="date"
            className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </div>
      </div>

      <div className="mt-3">
        <label className="text-xs text-zinc-600 dark:text-zinc-400">Note (optional)</label>
        <textarea
          name="purpose"
          rows={2}
          placeholder="What's different about this installment?"
          className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
      </div>

      <div className="mt-3">
        <label className="text-xs text-zinc-600 dark:text-zinc-400">Supporting documents (optional)</label>
        <input
          type="file"
          name="attachments"
          multiple
          accept="image/*,application/pdf"
          className="mt-1 block w-full text-xs"
        />
      </div>

      {state?.error && (
        <p className="mt-3 text-xs text-red-600 dark:text-red-400">{state.error}</p>
      )}
      {state?.info && (
        <p className="mt-3 text-xs text-emerald-600 dark:text-emerald-400">{state.info}</p>
      )}

      <div className="mt-3 flex justify-end gap-2">
        <button
          type="submit"
          disabled={pending || wouldExceed}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {pending ? "Submitting…" : "Submit for approval"}
        </button>
      </div>
    </form>
  );
}
