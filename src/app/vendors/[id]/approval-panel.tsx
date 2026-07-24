"use client";

import { useActionState } from "react";
import { approveVendor, rejectVendor } from "@/app/vendors/actions";

/**
 * Approval panel used on the vendor detail page (Accounts / Admin only).
 * If the vendor doesn't have bank details yet, this form collects them
 * before approving. approveVendor rejects without valid bank fields.
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

  return (
    <section className="mt-8 rounded-2xl border border-indigo-200 bg-indigo-50 p-6 dark:border-indigo-900 dark:bg-indigo-950/40">
      <h2 className="text-sm font-semibold text-indigo-900 dark:text-indigo-200">
        Verify this vendor
      </h2>
      <p className="mt-1 text-sm text-indigo-900 dark:text-indigo-200">
        {hasBank && hasPhone
          ? "Check GSTIN + bank details + cheque match. Then approve or reject."
          : "Fill in the missing details below (required to approve), then hit Approve."}
      </p>

      {/* Approve form — includes bank/contact fields when missing */}
      <form action={approveAction} className="mt-4 space-y-3">
        <input type="hidden" name="id" value={vendorId} />

        {!hasPhone && (
          <div className="rounded-md border border-indigo-200 bg-white p-4 dark:border-indigo-900 dark:bg-zinc-900">
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
              Vendor mobile number <span className="text-red-500">*</span>
            </label>
            <input
              name="phone"
              required
              type="tel"
              inputMode="numeric"
              placeholder="98765 43210"
              className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm sm:max-w-xs dark:border-zinc-700 dark:bg-zinc-900"
            />
          </div>
        )}

        {!hasBank && (
          <div className="grid grid-cols-1 gap-3 rounded-md border border-indigo-200 bg-white p-4 sm:grid-cols-2 dark:border-indigo-900 dark:bg-zinc-900">
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                Bank account number <span className="text-red-500">*</span>
              </label>
              <input
                name="bank_account_number"
                required
                className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-900"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                IFSC <span className="text-red-500">*</span>
              </label>
              <input
                name="bank_ifsc"
                required
                placeholder="HDFC0001234"
                className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-900"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                Bank name (optional)
              </label>
              <input
                name="bank_name"
                placeholder="HDFC Bank"
                className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                Branch (optional)
              </label>
              <input
                name="bank_branch"
                placeholder="Koramangala"
                className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              />
            </div>
          </div>
        )}

        {approveState?.error && (
          <p className="text-sm text-red-700 dark:text-red-300">{approveState.error}</p>
        )}

        <button
          type="submit"
          disabled={approvePending}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          {approvePending ? "Approving…" : "Approve"}
        </button>
      </form>

      {/* Reject form (separate — no bank details needed) */}
      <form
        action={rejectVendor}
        className="mt-3 flex flex-col gap-2 sm:flex-row"
      >
        <input type="hidden" name="id" value={vendorId} />
        <input
          name="reason"
          required
          placeholder="Reason for rejection"
          className="flex-1 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700">
          Reject
        </button>
      </form>
    </section>
  );
}
