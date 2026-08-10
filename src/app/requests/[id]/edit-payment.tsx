"use client";

import { useActionState, useState } from "react";
import { editPaymentRecord } from "@/app/requests/actions";

const FIELD =
  "w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-950";

/**
 * Correcting a recorded payment. Rendered only for Accounts — and re-checked
 * server-side, because a Server Action can be POSTed whatever the page shows.
 *
 * Collapsed until asked for: a money record that is right should not look
 * editable at a glance.
 */
export default function EditPayment({
  paymentId,
  paymentDate,
  paidAmount,
  utr,
  payingBank,
}: {
  paymentId: string;
  paymentDate: string;
  paidAmount: number;
  utr: string;
  payingBank: string | null;
}) {
  const [state, action, pending] = useActionState(editPaymentRecord, undefined);
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <div className="mt-1">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-[11px] font-medium text-emerald-800 underline underline-offset-2 hover:text-emerald-950 dark:text-emerald-300 dark:hover:text-emerald-100"
        >
          Correct these details
        </button>
        {state?.info && <p className="mt-1 text-[11px] text-emerald-800 dark:text-emerald-300">{state.info}</p>}
      </div>
    );
  }

  return (
    <form action={action} className="mt-2 rounded-md border border-emerald-200 bg-white p-2 dark:border-emerald-900 dark:bg-zinc-900">
      <input type="hidden" name="payment_id" value={paymentId} />
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-zinc-500">Date</span>
          <input type="date" name="payment_date" defaultValue={paymentDate} required className={FIELD} />
        </label>
        <label className="block">
          <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-zinc-500">Amount (₹)</span>
          <input name="paid_amount" defaultValue={String(paidAmount)} inputMode="decimal" required className={FIELD} />
        </label>
        <label className="block">
          <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-zinc-500">UTR</span>
          <input name="utr_reference" defaultValue={utr} required className={FIELD} />
        </label>
        <label className="block">
          <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-zinc-500">Paying bank</span>
          <input name="paying_bank_account" defaultValue={payingBank ?? ""} className={FIELD} />
        </label>
      </div>
      {/* Said out loud: this is a money record, and the correction is kept. */}
      <p className="mt-1.5 text-[10px] text-zinc-500">
        The change is written into this installment&rsquo;s history.
      </p>
      {state?.error && <p className="mt-1 text-[11px] text-red-700 dark:text-red-300">{state.error}</p>}
      <div className="mt-2 flex gap-2">
        <button
          disabled={pending}
          className="rounded-md bg-emerald-700 px-3 py-1 text-[11px] font-medium text-white hover:bg-emerald-800 disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save correction"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-[11px] font-medium text-zinc-500">
          Cancel
        </button>
      </div>
    </form>
  );
}
