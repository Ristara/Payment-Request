"use client";

import { useActionState, useState } from "react";
import {
  approveInstallment,
  rejectInstallment,
  cancelInstallment,
  editAndResubmitInstallment,
  markInstallmentBankUploaded,
  markInstallmentPaid,
  uploadInstallmentInvoice,
  closeInstallment,
} from "@/app/requests/actions";
import { formatINR } from "@/lib/types";

/**
 * Per-installment action row. Shown under each installment card on the
 * thread detail page. Only renders the buttons the current user can act on
 * given their role + the installment's current status.
 */
export default function InstallmentActions({
  installmentId,
  requestId,
  status,
  vendorStatus,
  isSubmitter,
  isApprover,
  isAccounts,
  isAdmin,
  requestedAmount,
  paymentDueDate,
  dateOfWorkCompletion,
  note,
  maxAmount,
}: {
  installmentId: string;
  requestId: string;
  status: string;
  vendorStatus: string;
  isSubmitter: boolean;
  isApprover: boolean;
  isAccounts: boolean;
  isAdmin: boolean;
  requestedAmount: number;
  paymentDueDate: string;
  dateOfWorkCompletion: string | null;
  note: string | null;
  maxAmount: number;
}) {
  const [editState, editAction, editPending] = useActionState(editAndResubmitInstallment, undefined);
  const [approveState, approveAction, approvePending] = useActionState(approveInstallment, undefined);
  const [rejectState, rejectAction, rejectPending] = useActionState(rejectInstallment, undefined);
  const [cancelState, cancelAction, cancelPending] = useActionState(cancelInstallment, undefined);
  const [bankState, bankAction, bankPending] = useActionState(markInstallmentBankUploaded, undefined);
  const [payState, payAction, payPending] = useActionState(markInstallmentPaid, undefined);
  const [invState, invAction, invPending] = useActionState(uploadInstallmentInvoice, undefined);
  const [closeState, closeAction, closePending] = useActionState(closeInstallment, undefined);

  const [open, setOpen] = useState<null | "reject" | "return" | "cancel" | "bank" | "pay" | "invoice" | "edit">(null);
  const [editAmount, setEditAmount] = useState(String(requestedAmount));
  const editAmountNum = Number(editAmount) || 0;
  const editOverMax = editAmountNum - maxAmount > 0.005;

  // Approve is allowed from clarification_required too — reading the
  // discussion and hitting Approve is what resolves it.
  const canApprove =
    (isApprover || isAdmin) &&
    ["pending_approval", "clarification_required"].includes(status) &&
    vendorStatus === "approved";
  const canReject = (isApprover || isAdmin) && (status === "pending_approval" || status === "clarification_required");
  const canBankUpload = (isAccounts || isAdmin) && status === "approved";
  const canMarkPaid = (isAccounts || isAdmin) && (status === "uploaded_in_bank" || status === "approved");
  const canUploadInvoice = status === "invoice_pending" || status === "payment_processed" || (isSubmitter && ["approved", "uploaded_in_bank"].includes(status));
  const canClose = (isAccounts || isAdmin) && ["invoice_pending", "payment_processed"].includes(status);
  // Cancel is only meaningful before money moves: once uploaded_in_bank or
  // beyond, the cash is committed and cancelling would free PO balance that
  // was actually spent.
  const canCancel =
    (isSubmitter || isAdmin) &&
    ["pending_approval", "clarification_required", "returned_for_correction", "approved"].includes(status);
  const canEditResubmit =
    (isSubmitter || isAdmin) && ["rejected", "returned_for_correction"].includes(status);

  if (!canApprove && !canReject && !canBankUpload && !canMarkPaid && !canUploadInvoice && !canClose && !canCancel && !canEditResubmit) {
    return null;
  }

  const info =
    editState?.info || approveState?.info || rejectState?.info || cancelState?.info ||
    bankState?.info || payState?.info || invState?.info || closeState?.info;
  const err =
    editState?.error || approveState?.error || rejectState?.error || cancelState?.error ||
    bankState?.error || payState?.error || invState?.error || closeState?.error;

  return (
    <div className="rounded-md border border-indigo-200 bg-indigo-50/50 p-3 dark:border-indigo-900 dark:bg-indigo-950/20">
      <div className="flex flex-wrap gap-2">
        {canEditResubmit && (
          <button
            onClick={() => setOpen(open === "edit" ? null : "edit")}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
          >
            ✎ Edit &amp; resubmit
          </button>
        )}
        {canApprove && (
          <form action={approveAction}>
            <input type="hidden" name="installment_id" value={installmentId} />
            <button disabled={approvePending} className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-60">
              {approvePending ? "Approving…" : "Approve"}
            </button>
          </form>
        )}
        {canReject && (
          <button onClick={() => setOpen(open === "reject" ? null : "reject")} className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700">
            Reject
          </button>
        )}
        {canBankUpload && (
          <button onClick={() => setOpen(open === "bank" ? null : "bank")} className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700">
            Mark bank upload
          </button>
        )}
        {canMarkPaid && (
          <button onClick={() => setOpen(open === "pay" ? null : "pay")} className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700">
            Record payment
          </button>
        )}
        {canUploadInvoice && (
          <button onClick={() => setOpen(open === "invoice" ? null : "invoice")} className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700">
            Upload invoice
          </button>
        )}
        {canClose && (
          <form action={closeAction}>
            <input type="hidden" name="installment_id" value={installmentId} />
            <button disabled={closePending} className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-60">
              {closePending ? "Closing…" : "Close"}
            </button>
          </form>
        )}
        {canCancel && (
          <button onClick={() => setOpen(open === "cancel" ? null : "cancel")} className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-900 dark:bg-zinc-900 dark:text-red-300 dark:hover:bg-red-950/40">
            Cancel installment
          </button>
        )}
      </div>

      {info && <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-300">{info}</p>}
      {err && <p className="mt-2 text-xs text-red-700 dark:text-red-300">{err}</p>}

      {open === "edit" && (
        <form action={editAction} className="mt-3 rounded-md border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
          <input type="hidden" name="installment_id" value={installmentId} />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="text-xs text-zinc-500">
              Amount (₹) — max {formatINR(maxAmount)}
              <input
                type="number"
                step="0.01"
                min="0"
                name="requested_amount"
                required
                value={editAmount}
                onChange={(e) => setEditAmount(e.target.value)}
                className={`mt-1 w-full rounded-md border bg-white px-2 py-1.5 text-xs dark:bg-zinc-900 ${
                  editOverMax ? "border-red-400 dark:border-red-700" : "border-zinc-300 dark:border-zinc-700"
                }`}
              />
              {editOverMax && (
                <span className="mt-0.5 block text-[10px] text-red-600 dark:text-red-400">
                  Exceeds available PO balance.
                </span>
              )}
            </label>
            <label className="text-xs text-zinc-500">
              Payment due date
              <input
                type="date"
                name="payment_due_date"
                required
                defaultValue={paymentDueDate}
                className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
              />
            </label>
            <label className="text-xs text-zinc-500">
              Work completion date
              <input
                type="date"
                name="date_of_work_completion"
                defaultValue={dateOfWorkCompletion ?? ""}
                className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
              />
            </label>
            <label className="text-xs text-zinc-500">
              Note (what changed?)
              <input
                name="purpose"
                defaultValue={note ?? ""}
                placeholder="e.g. corrected amount as discussed"
                className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
              />
            </label>
            <label className="text-xs text-zinc-500 sm:col-span-2">
              Attach corrected documents (optional)
              <input type="file" name="attachments" multiple accept="image/*,application/pdf" className="mt-1 block w-full text-xs" />
            </label>
          </div>
          <p className="mt-2 text-[11px] text-zinc-500">
            Tip: you can also remove old documents from the Supporting documents section above.
          </p>
          <div className="mt-2 flex justify-end">
            <button
              disabled={editPending || editOverMax}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
            >
              {editPending ? "Resubmitting…" : "Resubmit for approval"}
            </button>
          </div>
        </form>
      )}

      {open === "reject" && (
        <ReasonBox action={rejectAction} pending={rejectPending} installmentId={installmentId} label="Reason for rejection" submit="Reject" tone="red" />
      )}
      {open === "cancel" && (
        <ReasonBox action={cancelAction} pending={cancelPending} installmentId={installmentId} label="Reason for cancelling" submit="Cancel" tone="red" />
      )}

      {open === "bank" && (
        <form action={bankAction} className="mt-3 rounded-md border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
          <input type="hidden" name="installment_id" value={installmentId} />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <input type="date" name="bank_upload_date" required className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900" />
            <input name="bank_batch_ref" placeholder="Batch ref (optional)" className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900" />
          </div>
          <div className="mt-2 flex justify-end">
            <button disabled={bankPending} className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60">
              {bankPending ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      )}

      {open === "pay" && (
        <form action={payAction} className="mt-3 rounded-md border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
          <input type="hidden" name="installment_id" value={installmentId} />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="text-xs text-zinc-500">
              Payment date
              <input type="date" name="payment_date" required className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900" />
            </label>
            <label className="text-xs text-zinc-500">
              Amount paid (₹)
              <input type="number" step="0.01" min="0" name="paid_amount" required className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900" />
            </label>
            <label className="text-xs text-zinc-500">
              UTR reference
              <input name="utr_reference" required placeholder="N123456789012345" className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs font-mono dark:border-zinc-700 dark:bg-zinc-900" />
            </label>
            <label className="text-xs text-zinc-500">
              Paying bank a/c (optional)
              <input name="paying_bank_account" placeholder="HDFC ****1234" className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900" />
            </label>
            <label className="text-xs text-zinc-500 sm:col-span-2">
              Payment proof
              <input type="file" name="proof" accept="image/*,application/pdf" className="mt-1 block w-full text-xs" />
            </label>
          </div>
          <div className="mt-2 flex justify-end">
            <button disabled={payPending} className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60">
              {payPending ? "Saving…" : "Mark paid"}
            </button>
          </div>
        </form>
      )}

      {open === "invoice" && (
        <form action={invAction} className="mt-3 rounded-md border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
          <input type="hidden" name="installment_id" value={installmentId} />
          <label className="text-xs text-zinc-500">
            Tax invoice file
            <input type="file" name="invoice" required accept="image/*,application/pdf" className="mt-1 block w-full text-xs" />
          </label>
          <div className="mt-2 flex justify-end">
            <button disabled={invPending} className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60">
              {invPending ? "Uploading…" : "Upload"}
            </button>
          </div>
        </form>
      )}

      <input type="hidden" data-request-id={requestId} />
    </div>
  );
}

function ReasonBox({
  action, pending, installmentId, label, submit, tone,
}: {
  action: (fd: FormData) => void;
  pending: boolean;
  installmentId: string;
  label: string;
  submit: string;
  tone: "red" | "orange";
}) {
  const bg = tone === "red" ? "bg-red-600 hover:bg-red-700" : "bg-orange-600 hover:bg-orange-700";
  return (
    <form action={action} className="mt-3 rounded-md border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <input type="hidden" name="installment_id" value={installmentId} />
      <label className="text-xs text-zinc-500">
        {label}
        <textarea name="reason" required rows={2} className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900" />
      </label>
      <div className="mt-2 flex justify-end">
        <button disabled={pending} className={`rounded-md ${bg} px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60`}>
          {pending ? "Working…" : submit}
        </button>
      </div>
    </form>
  );
}
