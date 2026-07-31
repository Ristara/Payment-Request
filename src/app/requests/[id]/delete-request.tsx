"use client";

import { useActionState, useState } from "react";
import { deleteRequestAsAdmin } from "@/app/requests/actions";
import { formatINR } from "@/lib/types";

/**
 * Admin-only permanent delete.
 *
 * Deliberately two-step and deliberately specific: the panel names what goes
 * with it rather than asking "are you sure?" about an unknown quantity, and a
 * request with money already recorded against it needs its number typed out.
 */
export default function DeleteRequest({
  requestId,
  requestNumber,
  installmentCount,
  paidTotal,
}: {
  requestId: string;
  requestNumber: string;
  installmentCount: number;
  paidTotal: number;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(deleteRequestAsAdmin, undefined);
  const [confirmNumber, setConfirmNumber] = useState("");
  const [reason, setReason] = useState("");
  const hasPayments = paidTotal > 0;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs font-medium text-red-600 hover:underline dark:text-red-400"
      >
        Delete request
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-left dark:border-red-900 dark:bg-red-950/40">
      <p className="text-sm font-semibold text-red-900 dark:text-red-200">
        Delete {requestNumber} permanently?
      </p>
      <ul className="mt-2 space-y-1 text-xs text-red-800 dark:text-red-300">
        <li>
          · {installmentCount} payment{installmentCount === 1 ? "" : "s"}, their approvals, comments and
          attached files
        </li>
        <li>· The full history of who did what and when</li>
        {hasPayments && (
          <li className="font-semibold">
            · {formatINR(paidTotal)} recorded as paid — that payment record goes too
          </li>
        )}
      </ul>
      <p className="mt-2 text-xs text-red-800 dark:text-red-300">This cannot be undone.</p>

      <form action={action} className="mt-3 space-y-2">
        <input type="hidden" name="request_id" value={requestId} />
        <input
          name="reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (optional, kept in the deletion log)"
          className="w-full rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm dark:border-red-900 dark:bg-zinc-900"
        />
        {hasPayments && (
          <input
            name="confirm_number"
            value={confirmNumber}
            onChange={(e) => setConfirmNumber(e.target.value)}
            required
            placeholder={`Type ${requestNumber} to confirm`}
            className="w-full rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm dark:border-red-900 dark:bg-zinc-900"
          />
        )}
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-60"
          >
            {pending ? "Deleting…" : "Delete permanently"}
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
          >
            Cancel
          </button>
        </div>
        {state?.error && (
          <p className="text-xs font-medium text-red-700 dark:text-red-300">{state.error}</p>
        )}
      </form>
    </div>
  );
}
