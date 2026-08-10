"use client";

import Link from "next/link";
import PersistentFileInput from "@/components/PersistentFileInput";
import { useActionState, useEffect, useState } from "react";
import {
  queueForBankUpload,
  setInstallmentTds,
  approveInstallment,
  rejectInstallment,
  editAndResubmitInstallment,
  markInstallmentBankUploaded,
  markInstallmentPaid,
  uploadInstallmentInvoice,
  closeInstallment,
  reopenInstallment,
  recallInstallment,
  unapproveInstallment,
  submitDraftInstallment,
  deleteDraftInstallment,
} from "@/app/requests/actions";
import { formatINR } from "@/lib/types";

/**
 * Per-installment action row. Shown under each installment card on the
 * thread detail page. Only renders the buttons the current user can act on
 * given their role + the installment's current status.
 */
export type TdsSectionOption = {
  id: string;
  code: string;
  name: string;
  rate: number | null;
};

export default function InstallmentActions({
  installmentId,
  requestId,
  status,
  vendorStatus,
  amountOutstanding,
  vendorId,
  isSubmitter,
  isApprover,
  isAccounts,
  isAdmin,
  requestedAmount,
  tdsAmount = 0,
  tdsSection = null,
  tdsSectionId = null,
  tdsSections = [],
  queuedForUpload = false,
  paymentDueDate,
  dateOfWorkCompletion,
  tentativeInvoiceDate,
  needsTentativeInvoice,
  note,
  maxAmount,
}: {
  installmentId: string;
  requestId: string;
  status: string;
  vendorStatus: string;
  /** Requested amount minus everything paid so far. */
  amountOutstanding: number;
  vendorId: string;
  isSubmitter: boolean;
  isApprover: boolean;
  isAccounts: boolean;
  isAdmin: boolean;
  requestedAmount: number;
  /** Withheld by Accounts — the vendor is paid the difference. */
  tdsAmount?: number;
  tdsSection?: string | null;
  tdsSectionId?: string | null;
  /** The admin-managed list; only the active ones reach here. */
  tdsSections?: TdsSectionOption[];
  /** Already picked by Accounts for the next bank file. */
  queuedForUpload?: boolean;
  paymentDueDate: string;
  dateOfWorkCompletion: string | null;
  tentativeInvoiceDate: string | null;
  needsTentativeInvoice: boolean;
  note: string | null;
  maxAmount: number;
}) {
  const [editState, editAction, editPending] = useActionState(editAndResubmitInstallment, undefined);
  const [approveState, approveAction, approvePending] = useActionState(approveInstallment, undefined);
  const [rejectState, rejectAction, rejectPending] = useActionState(rejectInstallment, undefined);
  const [bankState, bankAction, bankPending] = useActionState(markInstallmentBankUploaded, undefined);
  const [payState, payAction, payPending] = useActionState(markInstallmentPaid, undefined);
  const [invState, invAction, invPending] = useActionState(uploadInstallmentInvoice, undefined);
  const [closeState, closeAction, closePending] = useActionState(closeInstallment, undefined);
  const [reopenState, reopenAction, reopenPending] = useActionState(reopenInstallment, undefined);
  const [recallState, recallAction, recallPending] = useActionState(recallInstallment, undefined);
  const [unapproveState, unapproveAction, unapprovePending] = useActionState(unapproveInstallment, undefined);
  const [submitState, submitAction, submitPending] = useActionState(submitDraftInstallment, undefined);
  const [dropState, dropAction, dropPending] = useActionState(deleteDraftInstallment, undefined);

  const [open, setOpen] = useState<null | "reject" | "bank" | "pay" | "invoice" | "edit" | "tds" | "amend" | "reopen">(null);
  const [editAmount, setEditAmount] = useState(String(requestedAmount));
  // Every field lives in state: React resets the form when an action runs,
  // so anything uncontrolled is wiped the moment the server rejects it.
  const [editDue, setEditDue] = useState(paymentDueDate);
  const [editWork, setEditWork] = useState(dateOfWorkCompletion ?? "");
  const [editTentative, setEditTentative] = useState(tentativeInvoiceDate ?? "");
  const [editNote, setEditNote] = useState(note ?? "");
  const [bankDate, setBankDate] = useState("");
  const [bankRef, setBankRef] = useState("");
  const [payDate, setPayDate] = useState("");
  // Pre-fill with what should actually have left the bank, so the common
  // case is a confirmation rather than a re-calculation.
  const netPayable = Math.max(requestedAmount - tdsAmount, 0);
  // Anything on the installment that isn't a live section — free text from
  // before this list existed, or one an admin turned off.
  const legacySection =
    tdsSection && !tdsSections.some((s) => s.id === tdsSectionId) ? tdsSection : null;
  const [sectionId, setSectionId] = useState(
    tdsSectionId ?? (legacySection ? "__legacy__" : ""),
  );
  const chosenRate = tdsSections.find((s) => s.id === sectionId)?.rate ?? null;

  const [tdsState, tdsAction, tdsPending] = useActionState(setInstallmentTds, undefined);
  const [queueState, queueAction, queuePending] = useActionState(queueForBankUpload, undefined);
  const [tdsInput, setTdsInput] = useState(tdsAmount ? String(tdsAmount) : "");

  /** What the chosen section's rate works out to on the approved amount. */
  const calculated =
    chosenRate == null ? null : Math.round(requestedAmount * chosenRate) / 100;

  // Picking a section fills the amount in straight away, overwriting whatever
  // was there. The box stays editable — TDS is often worked out on the value
  // before GST, and the invoice may already state a figure — so the rate is a
  // starting point, not a verdict.
  function chooseSection(id: string) {
    setSectionId(id);
    const rate = tdsSections.find((s) => s.id === id)?.rate;
    if (rate != null) setTdsInput((Math.round(requestedAmount * rate) / 100).toFixed(2));
    else if (id === "") setTdsInput("");
  }

  // A typed figure that no longer matches the rate. Worth saying out loud:
  // silently keeping it looks identical to the rate having been applied.
  const isCustomAmount =
    calculated != null &&
    tdsInput.trim() !== "" &&
    Math.abs(Number(tdsInput) - calculated) > 0.005;
  const [revisedAmt, setRevisedAmt] = useState(String(requestedAmount));
  const [paidAmt, setPaidAmt] = useState(String(netPayable));
  // Saving TDS re-renders this component with a new net, but useState keeps
  // its first value — without this the recorded payment would be the pre-TDS
  // gross while the bank actually paid the net.
  useEffect(() => {
    setPaidAmt(String(Math.max(requestedAmount - tdsAmount, 0)));
  }, [requestedAmount, tdsAmount]);
  const [utr, setUtr] = useState("");
  const [payingAcct, setPayingAcct] = useState("");
  const editAmountNum = Number(editAmount) || 0;
  const editOverMax = editAmountNum - maxAmount > 0.005;

  // Approve is allowed from clarification_required too — reading the
  // discussion and hitting Approve is what resolves it.
  // A pending vendor no longer blocks approval. Approving is a decision about
  // whether the spend is justified; whether the vendor has been verified is a
  // question about whether it can be PAID, and that is checked at every step
  // downstream — queueing to a bank file, marking uploaded, and recording the
  // payment all still refuse an unapproved vendor. Blocking here just stalled
  // the decision while somebody chased paperwork.
  const canApprove =
    (isApprover || isAdmin) &&
    ["pending_approval", "clarification_required"].includes(status);
  const canReject = (isApprover || isAdmin) && (status === "pending_approval" || status === "clarification_required");
  // Not a block any more — a warning, so an approver knows this will sit in
  // Accounts' queue rather than being paid.
  const vendorNotReady =
    (isApprover || isAdmin) &&
    ["pending_approval", "clarification_required"].includes(status) &&
    vendorStatus !== "approved";
  // Executing a payment is the Accounts role, not a seniority level. Admin
  // used to imply it, which put "Record payment" in front of approvers who
  // happened to be admins — the one pair of jobs that most needs separating.
  // An admin who genuinely does the paying gets the Accounts role.
  const canBankUpload = isAccounts && status === "approved";
  // Withholding is decided before the money leaves; after that the bank has
  // already been told an amount.
  const canSetTds = isAccounts && status === "approved";
  // The same queue the Accounts list drives, reachable from the request
  // itself — that's where you are when you've just checked the invoice.
  const canQueue = isAccounts && status === "approved";
  // Also available while a balance remains, whatever the status. Instalments
  // part-paid before this existed were moved straight to invoice_pending, so
  // without this there is no way to record the rest of the money.
  const partPaid = amountOutstanding > 0.5 && ["invoice_pending", "payment_processed"].includes(status);
  const canMarkPaid =
    isAccounts && (status === "uploaded_in_bank" || status === "approved" || partPaid);
  const canUploadInvoice = status === "invoice_pending" || status === "payment_processed" || (isSubmitter && ["approved", "uploaded_in_bank"].includes(status));
  const canClose = isAccounts && ["invoice_pending", "payment_processed"].includes(status);
  // Closing was one-way. Accounts can now pull one back when it was closed
  // against the wrong invoice, or before the invoice actually arrived.
  const canReopen = isAccounts && status === "closed";
  const canEditResubmit =
    (isSubmitter || isAdmin) && ["rejected", "returned_for_correction", "draft"].includes(status);
  // Withdraw your own ask while it's still waiting on a decision.
  const canRecall = isSubmitter && ["pending_approval", "clarification_required"].includes(status);
  // Pull an approval back — only until Accounts picks it up for the bank.
  const canUnapprove = (isApprover || isAdmin) && status === "approved";
  const canSubmitDraft = isSubmitter && status === "draft";

  if (
    !canApprove && !canReject && !canBankUpload && !canMarkPaid && !canUploadInvoice && !canSetTds && !canQueue &&
    !canClose && !canReopen && !canEditResubmit && !canRecall && !canUnapprove && !canSubmitDraft
  ) {
    return null;
  }

  // Close the open panel once its action succeeds. Leaving it open with the
  // chosen file still listed reads as "nothing happened" — which is why the
  // same invoice ended up uploaded twice. Unmounting the form also clears the
  // file input, whose whole job is otherwise to survive a reset.
  useEffect(() => {
    if (invState?.info || payState?.info || bankState?.info || tdsState?.info) setOpen(null);
  }, [invState?.info, payState?.info, bankState?.info, tdsState?.info]);

  const info =
    editState?.info || approveState?.info || rejectState?.info ||
    bankState?.info || payState?.info || invState?.info || closeState?.info || reopenState?.info ||
    recallState?.info || unapproveState?.info || submitState?.info || dropState?.info;
  const err =
    editState?.error || approveState?.error || rejectState?.error ||
    bankState?.error || payState?.error || invState?.error || closeState?.error || reopenState?.error ||
    recallState?.error || unapproveState?.error || submitState?.error || dropState?.error;

  return (
    <div className="rounded-md border border-indigo-200 bg-indigo-50/50 p-3 dark:border-indigo-900 dark:bg-indigo-950/20">
      {vendorNotReady && (
        <p className="mb-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          You can approve this, but it can&rsquo;t be paid yet — the vendor is{" "}
          {vendorStatus === "rejected" ? "rejected" : "still awaiting verification"}. Accounts
          can&rsquo;t put it in a bank file until they&rsquo;ve verified it (bank details + mobile).{" "}
          <Link href={`/vendors/${vendorId}`} className="font-medium underline">
            Open vendor
          </Link>
        </p>
      )}
      {queuedForUpload && (
        <p className="mb-2 rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-800 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-200">
          Queued for the next bank file.
        </p>
      )}
      {(queueState?.info || queueState?.error) && (
        <p
          className={`mb-2 text-xs font-medium ${
            queueState.error ? "text-red-700 dark:text-red-300" : "text-emerald-700 dark:text-emerald-300"
          }`}
        >
          {queueState.error ?? queueState.info}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {canSubmitDraft && (
          <form action={submitAction}>
            <input type="hidden" name="installment_id" value={installmentId} />
            <button
              type="submit"
              disabled={submitPending}
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              {submitPending ? "Submitting…" : "Submit for approval"}
            </button>
          </form>
        )}
        {canSubmitDraft && (
          <form
            action={dropAction}
            onSubmit={(e) => {
              if (!confirm("Delete this draft? If it's the only installment, the whole request is removed. This can't be undone.")) {
                e.preventDefault();
              }
            }}
          >
            <input type="hidden" name="installment_id" value={installmentId} />
            <button
              type="submit"
              disabled={dropPending}
              className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-60 dark:border-red-900 dark:bg-zinc-900 dark:text-red-300"
            >
              {dropPending ? "Deleting…" : "Delete draft"}
            </button>
          </form>
        )}
        {canRecall && (
          <form action={recallAction}>
            <input type="hidden" name="installment_id" value={installmentId} />
            <button
              type="submit"
              disabled={recallPending}
              title="Withdraw this from the approver's queue and keep it as a draft"
              className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
            >
              {recallPending ? "Recalling…" : "↩ Recall to draft"}
            </button>
          </form>
        )}
        {canUnapprove && (
          <form action={unapproveAction}>
            <input type="hidden" name="installment_id" value={installmentId} />
            <button
              type="submit"
              disabled={unapprovePending}
              title="Send this back to the approval queue — only possible until Accounts uploads it to the bank"
              className="rounded-md border border-amber-400 bg-white px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-50 disabled:opacity-60 dark:border-amber-700 dark:bg-zinc-900 dark:text-amber-200"
            >
              {unapprovePending ? "Reverting…" : "↩ Back to pending"}
            </button>
          </form>
        )}
        {canEditResubmit && (
          <button
            onClick={() => setOpen(open === "edit" ? null : "edit")}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
          >
            ✎ {status === "draft" ? "Edit draft" : "Edit \u0026 resubmit"}
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
        {canApprove && (
          <button
            type="button"
            onClick={() => setOpen(open === "amend" ? null : "amend")}
            className="rounded-md border border-emerald-300 bg-white px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:bg-zinc-900 dark:text-emerald-300 dark:hover:bg-emerald-950/40"
          >
            Approve a different amount
          </button>
        )}
        {canReject && (
          <button onClick={() => setOpen(open === "reject" ? null : "reject")} className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700">
            Reject
          </button>
        )}
        {canSetTds && (
          <button
            type="button"
            onClick={() => setOpen(open === "tds" ? null : "tds")}
            className="rounded-md border border-indigo-300 bg-white px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-50 dark:border-indigo-800 dark:bg-zinc-900 dark:text-indigo-300 dark:hover:bg-indigo-950/40"
          >
            {tdsAmount > 0 ? `TDS ${formatINR(tdsAmount)}` : "Deduct TDS"}
          </button>
        )}
        {canQueue && (
          <form action={queueAction}>
            <input type="hidden" name="installment_ids" value={installmentId} />
            <input type="hidden" name="action" value={queuedForUpload ? "unqueue" : "queue"} />
            <button
              type="submit"
              disabled={queuePending}
              className={`rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-60 ${
                queuedForUpload
                  ? "border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
                  : "bg-indigo-600 text-white hover:bg-indigo-700"
              }`}
            >
              {queuePending
                ? "Moving…"
                : queuedForUpload
                  ? "Remove from To upload"
                  : "Move to To upload"}
            </button>
          </form>
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
        {canReopen && (
          <button
            type="button"
            onClick={() => setOpen(open === "reopen" ? null : "reopen")}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            Reopen
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
      </div>

      {open === "reopen" && (
        <form action={reopenAction} className="mt-3 rounded-md border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
          <input type="hidden" name="installment_id" value={installmentId} />
          <p className="text-xs text-zinc-600 dark:text-zinc-300">
            This goes back to <strong>invoice pending</strong>. The payment record is
            untouched — the money has already gone; it is the invoice that is unfinished.
          </p>
          <input
            name="reason"
            required
            minLength={3}
            placeholder="Why is it being reopened?"
            className="mt-2 w-full rounded-md border border-zinc-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-950"
          />
          <div className="mt-2 flex gap-2">
            <button disabled={reopenPending} className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
              {reopenPending ? "Reopening…" : "Reopen"}
            </button>
            <button type="button" onClick={() => setOpen(null)} className="rounded-md px-3 py-1.5 text-xs font-medium text-zinc-500">
              Cancel
            </button>
          </div>
        </form>
      )}

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
                value={editDue}
                onChange={(e) => setEditDue(e.target.value)}
                required
                className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
              />
            </label>
            <label className="text-xs text-zinc-500">
              Work completion date
              <input
                type="date"
                name="date_of_work_completion"
                value={editWork}
                onChange={(e) => setEditWork(e.target.value)}
                className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
              />
            </label>
            {needsTentativeInvoice && (
              <label className="text-xs text-zinc-500">
                Tentative invoice date <span className="text-red-500">*</span>
                <input
                  name="tentative_invoice_date"
                value={editTentative}
                onChange={(e) => setEditTentative(e.target.value)}
                  type="date"
                  required
                  className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                />
              </label>
            )}
            <label className="text-xs text-zinc-500">
              Note (what changed?)
              <input
                name="purpose"
                value={editNote}
                onChange={(e) => setEditNote(e.target.value)}
                placeholder="e.g. corrected amount as discussed"
                className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
              />
            </label>
            <label className="text-xs text-zinc-500 sm:col-span-2">
              Attach corrected documents (optional)
              <PersistentFileInput name="attachments" multiple accept="image/*,application/pdf" label="Add supporting documents" className="mt-1" />
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

      {open === "amend" && (
        <form action={approveAction} className="mt-3 rounded-md border border-emerald-200 bg-emerald-50/60 p-3 dark:border-emerald-900 dark:bg-emerald-950/20">
          <input type="hidden" name="installment_id" value={installmentId} />
          <p className="text-xs text-emerald-900 dark:text-emerald-200">
            Approve less than was asked for — for part delivery, or a correction —
            without sending the whole request back.
          </p>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <label className="text-xs text-zinc-500">
              Approve this amount (₹)
              <input
                type="number"
                step="0.01"
                min="0.01"
                max={maxAmount}
                name="revised_amount"
                value={revisedAmt}
                onChange={(e) => setRevisedAmt(e.target.value)}
                required
                className="mt-1 w-40 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs tabular-nums dark:border-zinc-700 dark:bg-zinc-900"
              />
            </label>
            <p className="pb-1.5 text-xs text-zinc-500">
              Requested {formatINR(requestedAmount)}
              {Number(revisedAmt) > 0 && Math.abs(Number(revisedAmt) - requestedAmount) > 0.005 && (
                <span className="ml-1 font-medium text-emerald-700 dark:text-emerald-300">
                  → {formatINR(Number(revisedAmt))}
                </span>
              )}
            </p>
          </div>
          <p className="mt-1 text-[11px] text-zinc-500">
            {Number(revisedAmt) > 0 && Math.abs(Number(revisedAmt) - requestedAmount) > 0.005
              ? "The submitter is notified that you changed it, and the change is recorded on the timeline."
              : "Same as requested — this approves it unchanged."}
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="submit"
              disabled={approvePending}
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              {approvePending ? "Approving…" : "Approve"}
            </button>
            <button
              type="button"
              onClick={() => { setOpen(null); setRevisedAmt(String(requestedAmount)); }}
              className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {open === "tds" && (
        <form action={tdsAction} className="mt-3 rounded-md border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
          <input type="hidden" name="installment_id" value={installmentId} />
          {sectionId === "__legacy__" && (
            <input type="hidden" name="tds_section_text" value={legacySection ?? ""} />
          )}
          <p className="text-xs text-zinc-500">
            Withheld from this payment. The {formatINR(requestedAmount)}{" "}
            approved doesn&apos;t change — the vendor is paid the difference.
          </p>
          {/* Section first, then amount: choosing the section is what fills
              the amount in, so reading left to right matches doing it. */}
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <label className="text-xs text-zinc-500">
              Section (optional)
              <select
                name="tds_section_id"
                value={sectionId}
                onChange={(e) => chooseSection(e.target.value)}
                className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
              >
                <option value="">No section</option>
                {tdsSections.map((sec) => (
                  <option key={sec.id} value={sec.id}>
                    {sec.code} — {sec.name}
                    {sec.rate === null ? "" : ` (${sec.rate}%)`}
                  </option>
                ))}
                {/* Whatever was typed before the list existed, or a section an
                    admin has since turned off. Keeping it selectable means
                    saving an amount can't quietly erase it. */}
                {legacySection && (
                  <option value="__legacy__">{legacySection}</option>
                )}
              </select>
            </label>

            <label className="text-xs text-zinc-500">
              TDS amount (₹)
              <input
                type="number"
                step="0.01"
                min="0"
                max={requestedAmount}
                name="tds_amount"
                value={tdsInput}
                onChange={(e) => setTdsInput(e.target.value)}
                placeholder="0.00"
                className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs tabular-nums dark:border-zinc-700 dark:bg-zinc-900"
              />
              {isCustomAmount ? (
                <span className="mt-1 block text-amber-700 dark:text-amber-400">
                  Your own figure, not the {chosenRate}% —{" "}
                  <button
                    type="button"
                    onClick={() => setTdsInput(calculated!.toFixed(2))}
                    className="underline hover:no-underline"
                  >
                    use {formatINR(calculated!)}
                  </button>
                </span>
              ) : (
                calculated != null && (
                  <span className="mt-1 block text-zinc-400">
                    Worked out at {chosenRate}% — type over it if the invoice says
                    otherwise.
                  </span>
                )
              )}
              {sectionId !== "" && sectionId !== "__legacy__" && chosenRate == null && (
                <span className="mt-1 block text-amber-700 dark:text-amber-400">
                  No rate set for this section — enter the amount yourself.
                </span>
              )}
            </label>

            <div className="text-xs text-zinc-500 sm:self-end sm:pb-1.5">
              Vendor gets{" "}
              <span className="font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                {formatINR(Math.max(requestedAmount - (Number(tdsInput) || 0), 0))}
              </span>
              {chosenRate != null && (
                <span className="mt-0.5 block text-zinc-400">
                  {chosenRate}% of {formatINR(requestedAmount)}
                </span>
              )}
            </div>
          </div>

          <div className="mt-2 flex items-center gap-2">
            <button
              type="submit"
              disabled={tdsPending}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {tdsPending ? "Saving…" : "Save TDS"}
            </button>
            {tdsAmount > 0 && (
              <button
                type="button"
                onClick={() => setTdsInput("0")}
                className="text-xs text-zinc-500 hover:underline"
              >
                Clear
              </button>
            )}
          </div>
          {tdsState?.error && (
            <p className="mt-2 text-xs font-medium text-red-700 dark:text-red-300">{tdsState.error}</p>
          )}
          {tdsState?.info && (
            <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-300">{tdsState.info}</p>
          )}
        </form>
      )}

      {open === "bank" && (
        <form action={bankAction} className="mt-3 rounded-md border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
          <input type="hidden" name="installment_id" value={installmentId} />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <input type="date" name="bank_upload_date"
                value={bankDate}
                onChange={(e) => setBankDate(e.target.value)} required className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900" />
            <input name="bank_batch_ref"
                value={bankRef}
                onChange={(e) => setBankRef(e.target.value)} placeholder="Batch ref (optional)" className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900" />
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
              <input type="date" name="payment_date"
                value={payDate}
                onChange={(e) => setPayDate(e.target.value)} required className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900" />
            </label>
            <label className="text-xs text-zinc-500">
              Amount paid (₹)
              {tdsAmount > 0 && (
                <span className="ml-1 text-[10px] text-zinc-400">
                  approved {formatINR(requestedAmount)} less TDS {formatINR(tdsAmount)}
                </span>
              )}
              <input type="number" step="0.01" min="0" name="paid_amount"
                value={paidAmt}
                onChange={(e) => setPaidAmt(e.target.value)} required className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900" />
            </label>
            <label className="text-xs text-zinc-500">
              UTR reference
              <input name="utr_reference"
                value={utr}
                onChange={(e) => setUtr(e.target.value)} required placeholder="N123456789012345" className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs font-mono dark:border-zinc-700 dark:bg-zinc-900" />
            </label>
            <label className="text-xs text-zinc-500">
              Paying bank a/c (optional)
              <input name="paying_bank_account"
                value={payingAcct}
                onChange={(e) => setPayingAcct(e.target.value)} placeholder="HDFC ****1234" className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900" />
            </label>
            <label className="text-xs text-zinc-500 sm:col-span-2">
              Payment proof
              <PersistentFileInput name="proof" accept="image/*,application/pdf" label="Attach the payment proof" className="mt-1" />
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
            <PersistentFileInput name="invoice" required accept="image/*,application/pdf" label="Attach the invoice" className="mt-1" />
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
  // Local state so a rejected submit doesn't erase the reason just typed.
  const [reason, setReason] = useState("");
  return (
    <form action={action} className="mt-3 rounded-md border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <input type="hidden" name="installment_id" value={installmentId} />
      <label className="text-xs text-zinc-500">
        {label}
        <textarea
          name="reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          required
          rows={2} className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900" />
      </label>
      <div className="mt-2 flex justify-end">
        <button disabled={pending} className={`rounded-md ${bg} px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60`}>
          {pending ? "Working…" : submit}
        </button>
      </div>
    </form>
  );
}
