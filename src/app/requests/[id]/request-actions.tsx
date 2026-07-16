"use client";

import { useActionState, useState } from "react";
import {
  approveRequest,
  rejectRequest,
  returnRequest,
  cancelRequest,
  updateLineCoa,
  markBankUploaded,
  markPaid,
  uploadInvoice,
  closeRequest,
} from "@/app/requests/actions";

type Coa = { id: string; code: number; subcategory: string; category: string; coa: string };
type LineItem = { id: string; coa_account_id: string; label: string };

export default function RequestActions({
  requestId,
  status,
  vendorStatus,
  isSubmitter,
  isApprover,
  isAccounts,
  isAdmin,
  coaHeads,
  lineItems,
}: {
  requestId: string;
  status: string;
  vendorStatus: string;
  isSubmitter: boolean;
  isApprover: boolean;
  isAccounts: boolean;
  isAdmin: boolean;
  coaHeads: Coa[];
  lineItems: LineItem[];
}) {
  const [approveState, approveAction, approvePending] = useActionState(approveRequest, undefined);
  const [rejectState, rejectAction, rejectPending] = useActionState(rejectRequest, undefined);
  const [returnState, returnAction, returnPending] = useActionState(returnRequest, undefined);
  const [cancelState, cancelAction, cancelPending] = useActionState(cancelRequest, undefined);
  const [coaState, coaAction, coaPending] = useActionState(updateLineCoa, undefined);
  const [bankState, bankAction, bankPending] = useActionState(markBankUploaded, undefined);
  const [payState, payAction, payPending] = useActionState(markPaid, undefined);
  const [invState, invAction, invPending] = useActionState(uploadInvoice, undefined);
  const [closeState, closeAction, closePending] = useActionState(closeRequest, undefined);

  const [openBox, setOpenBox] = useState<null | "reject" | "return" | "cancel" | "coa" | "bank" | "pay" | "invoice">(null);
  const [selectedLineId, setSelectedLineId] = useState<string>(lineItems[0]?.id ?? "");
  const selectedLine = lineItems.find((l) => l.id === selectedLineId);

  const canApprove = (isApprover || isAdmin) && status === "pending_approval" && vendorStatus === "approved";
  const canRejectReturn = (isApprover || isAdmin) && (status === "pending_approval" || status === "clarification_required");
  const canBankUpload = (isAccounts || isAdmin) && status === "approved";
  const canMarkPaid = (isAccounts || isAdmin) && (status === "uploaded_in_bank" || status === "approved");
  const canUploadInvoice = status === "invoice_pending" || status === "payment_processed" || (isSubmitter && ["approved", "uploaded_in_bank"].includes(status));
  const canClose = (isAccounts || isAdmin) && ["invoice_pending", "payment_processed"].includes(status);
  const canReclassify = (isApprover || isAccounts || isAdmin) && lineItems.length > 0 && !["closed", "cancelled", "rejected"].includes(status);
  const canCancel = (isSubmitter || isAdmin) && !["closed", "cancelled", "rejected", "payment_processed"].includes(status);

  if (!canApprove && !canRejectReturn && !canBankUpload && !canMarkPaid && !canUploadInvoice && !canClose && !canReclassify && !canCancel) {
    return null;
  }

  const successBanner =
    approveState?.info || rejectState?.info || returnState?.info || cancelState?.info ||
    coaState?.info || bankState?.info || payState?.info || invState?.info || closeState?.info;
  const errorBanner =
    approveState?.error || rejectState?.error || returnState?.error || cancelState?.error ||
    coaState?.error || bankState?.error || payState?.error || invState?.error || closeState?.error;

  return (
    <section className="rounded-2xl border border-indigo-200 bg-indigo-50 p-5 dark:border-indigo-900 dark:bg-indigo-950/40">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-indigo-800 dark:text-indigo-200">
        Actions
      </h2>

      <div className="mt-3 flex flex-wrap gap-2">
        {canApprove && (
          <form action={approveAction}>
            <input type="hidden" name="request_id" value={requestId} />
            <button
              disabled={approvePending}
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              {approvePending ? "Approving…" : "Approve"}
            </button>
          </form>
        )}
        {canRejectReturn && (
          <>
            <button
              onClick={() => setOpenBox(openBox === "return" ? null : "return")}
              className="rounded-md bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700"
            >
              Return for correction
            </button>
            <button
              onClick={() => setOpenBox(openBox === "reject" ? null : "reject")}
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
            >
              Reject
            </button>
          </>
        )}
        {canReclassify && (
          <button
            onClick={() => setOpenBox(openBox === "coa" ? null : "coa")}
            className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Reclassify line
          </button>
        )}
        {canBankUpload && (
          <button
            onClick={() => setOpenBox(openBox === "bank" ? null : "bank")}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            Mark bank upload
          </button>
        )}
        {canMarkPaid && (
          <button
            onClick={() => setOpenBox(openBox === "pay" ? null : "pay")}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            Record payment
          </button>
        )}
        {canUploadInvoice && (
          <button
            onClick={() => setOpenBox(openBox === "invoice" ? null : "invoice")}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            Upload invoice
          </button>
        )}
        {canClose && (
          <form action={closeAction}>
            <input type="hidden" name="request_id" value={requestId} />
            <button
              disabled={closePending}
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              {closePending ? "Closing…" : "Close request"}
            </button>
          </form>
        )}
        {canCancel && (
          <button
            onClick={() => setOpenBox(openBox === "cancel" ? null : "cancel")}
            className="rounded-md border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-red-900 dark:bg-zinc-900 dark:text-red-300 dark:hover:bg-red-950/40"
          >
            Cancel request
          </button>
        )}
      </div>

      {successBanner && <p className="mt-3 text-sm text-emerald-700 dark:text-emerald-300">{successBanner}</p>}
      {errorBanner && <p className="mt-3 text-sm text-red-700 dark:text-red-300">{errorBanner}</p>}

      {openBox === "reject" && (
        <FormBox action={rejectAction} pending={rejectPending} requestId={requestId} label="Reason for rejection" name="reason" submit="Reject" tone="red" />
      )}
      {openBox === "return" && (
        <FormBox action={returnAction} pending={returnPending} requestId={requestId} label="What needs correcting?" name="reason" submit="Return" tone="orange" />
      )}
      {openBox === "cancel" && (
        <FormBox action={cancelAction} pending={cancelPending} requestId={requestId} label="Reason for cancelling" name="reason" submit="Cancel request" tone="red" />
      )}

      {openBox === "coa" && (
        <form action={coaAction} className="mt-4 rounded-md border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <input type="hidden" name="request_id" value={requestId} />
          <input type="hidden" name="line_id" value={selectedLineId} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="text-xs text-zinc-500">
              Line
              <select
                value={selectedLineId}
                onChange={(e) => setSelectedLineId(e.target.value)}
                className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              >
                {lineItems.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-zinc-500">
              New subcategory
              <select
                name="coa_account_id"
                required
                defaultValue={selectedLine?.coa_account_id ?? ""}
                key={selectedLineId}
                className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              >
                {coaHeads.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.subcategory} — {c.category}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-zinc-500">
              Reason
              <input
                name="reason"
                required
                placeholder="Why the change?"
                className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              />
            </label>
          </div>
          <div className="mt-3 flex justify-end">
            <button disabled={coaPending} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
              {coaPending ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      )}

      {openBox === "bank" && (
        <form action={bankAction} className="mt-4 rounded-md border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <input type="hidden" name="request_id" value={requestId} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <input type="date" name="bank_upload_date" required className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
            <input name="bank_batch_ref" placeholder="Batch ref (optional)" className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
          </div>
          <div className="mt-3 flex justify-end">
            <button disabled={bankPending} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
              {bankPending ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      )}

      {openBox === "pay" && (
        <form action={payAction} className="mt-4 rounded-md border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <input type="hidden" name="request_id" value={requestId} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs text-zinc-500">Payment date</label>
              <input type="date" name="payment_date" required className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
            </div>
            <div>
              <label className="text-xs text-zinc-500">Amount paid (₹)</label>
              <input type="number" step="0.01" min="0" name="paid_amount" required className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
            </div>
            <div>
              <label className="text-xs text-zinc-500">UTR reference</label>
              <input name="utr_reference" required placeholder="N123456789012345" className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-mono dark:border-zinc-700 dark:bg-zinc-900" />
            </div>
            <div>
              <label className="text-xs text-zinc-500">Paying bank a/c (optional)</label>
              <input name="paying_bank_account" placeholder="HDFC ****1234" className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs text-zinc-500">Payment proof (screenshot / bank confirmation)</label>
              <input type="file" name="proof" accept="image/*,application/pdf" className="mt-1 block w-full text-sm text-zinc-700 file:mr-3 file:rounded-md file:border-0 file:bg-indigo-50 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-indigo-700 hover:file:bg-indigo-100 dark:text-zinc-300" />
            </div>
          </div>
          <div className="mt-3 flex justify-end">
            <button disabled={payPending} className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
              {payPending ? "Saving…" : "Mark paid"}
            </button>
          </div>
        </form>
      )}

      {openBox === "invoice" && (
        <form action={invAction} className="mt-4 rounded-md border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <input type="hidden" name="request_id" value={requestId} />
          <label className="text-xs text-zinc-500">Tax invoice file</label>
          <input type="file" name="invoice" required accept="image/*,application/pdf" className="mt-1 block w-full text-sm text-zinc-700 file:mr-3 file:rounded-md file:border-0 file:bg-indigo-50 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-indigo-700 hover:file:bg-indigo-100 dark:text-zinc-300" />
          <div className="mt-3 flex justify-end">
            <button disabled={invPending} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
              {invPending ? "Uploading…" : "Upload invoice"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function FormBox({
  action,
  pending,
  requestId,
  label,
  name,
  submit,
  tone,
}: {
  action: (formData: FormData) => void;
  pending: boolean;
  requestId: string;
  label: string;
  name: string;
  submit: string;
  tone: "red" | "orange";
}) {
  const bg = tone === "red" ? "bg-red-600 hover:bg-red-700" : "bg-orange-600 hover:bg-orange-700";
  return (
    <form action={action} className="mt-4 rounded-md border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <input type="hidden" name="request_id" value={requestId} />
      <label className="text-xs text-zinc-500">{label}</label>
      <textarea
        name={name}
        required
        rows={2}
        className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
      />
      <div className="mt-3 flex justify-end">
        <button disabled={pending} className={`rounded-md ${bg} px-4 py-2 text-sm font-medium text-white disabled:opacity-60`}>
          {pending ? "Working…" : submit}
        </button>
      </div>
    </form>
  );
}
