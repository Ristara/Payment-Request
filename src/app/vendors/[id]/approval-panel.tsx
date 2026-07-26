"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { approveVendor, rejectVendor } from "@/app/vendors/actions";

/**
 * Compact approve / reject actions for the vendor header (Accounts / Admin).
 * Missing bank or contact details are filled through Edit, so this no longer
 * carries a form of its own — Approve stays disabled until the record is
 * complete.
 */
export default function ApprovalPanel({
  vendorId,
  hasBank,
  hasPhone,
}: {
  vendorId: string;
  hasBank: boolean;
  hasPhone: boolean;
}) {
  const [approveState, approveAction, approvePending] = useActionState(approveVendor, undefined);
  const [rejecting, setRejecting] = useState(false);
  const ready = hasBank && hasPhone;

  const missing = [!hasPhone && "mobile number", !hasBank && "bank details"]
    .filter(Boolean)
    .join(" and ");

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-2">
        {ready ? (
          <form action={approveAction}>
            <input type="hidden" name="id" value={vendorId} />
            <button
              type="submit"
              disabled={approvePending}
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              {approvePending ? "Approving…" : "Approve"}
            </button>
          </form>
        ) : (
          <Link
            href={`/vendors/${vendorId}/edit`}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
          >
            Add {missing} to approve
          </Link>
        )}

        <button
          type="button"
          onClick={() => setRejecting((r) => !r)}
          className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/40"
        >
          Reject
        </button>
      </div>

      {rejecting && (
        <form action={rejectVendor} className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
          <input type="hidden" name="id" value={vendorId} />
          <input
            name="reason"
            required
            autoFocus
            placeholder="Reason for rejection"
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm sm:max-w-xs dark:border-zinc-700 dark:bg-zinc-900"
          />
          <div className="flex gap-2">
            <button className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700">
              Confirm reject
            </button>
            <button
              type="button"
              onClick={() => setRejecting(false)}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {approveState?.error && (
        <p className="mt-2 text-xs text-red-700 dark:text-red-300">{approveState.error}</p>
      )}
    </div>
  );
}
