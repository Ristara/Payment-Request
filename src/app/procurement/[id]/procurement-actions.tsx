"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  approveProcurementRequest,
  rejectProcurementRequest,
  recordPurchaseOrder,
  cancelProcurementRequest,
  deleteProcurementRequest,
} from "@/app/procurement/actions";

export type VendorOption = { id: string; name: string };

const FIELD =
  "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-950";

/**
 * Only the buttons this person can actually press, given their role and where
 * the request has got to.
 *
 * Presentation only — every action re-checks the role and the current status
 * server-side. A Server Action can be POSTed directly whatever this renders.
 */
export default function ProcurementActions({
  id,
  status,
  isSubmitter,
  canApprove,
  canProcure,
  vendors,
}: {
  id: string;
  status: string;
  isSubmitter: boolean;
  canApprove: boolean;
  canProcure: boolean;
  vendors: VendorOption[];
}) {
  const [approveState, approve, approving] = useActionState(approveProcurementRequest, undefined);
  const [rejectState, reject, rejecting] = useActionState(rejectProcurementRequest, undefined);
  const [poState, recordPo, recordingPo] = useActionState(recordPurchaseOrder, undefined);
  const [cancelState, cancel, cancelling] = useActionState(cancelProcurementRequest, undefined);
  const [delState, del, deleting] = useActionState(deleteProcurementRequest, undefined);
  const [open, setOpen] = useState<null | "reject" | "po" | "delete">(null);
  const router = useRouter();

  // Back to the list once it is gone — staying on the detail page of a deleted
  // request means the next refresh is a 404.
  useEffect(() => {
    if (delState?.info) router.push("/procurement");
  }, [delState?.info, router]);

  const info = approveState?.info || rejectState?.info || poState?.info || cancelState?.info || delState?.info;
  const err = approveState?.error || rejectState?.error || poState?.error || cancelState?.error || delState?.error;

  const pending = status === "pending_approval";
  const approved = status === "approved";

  // An approver looking at their own request gets no approve button — the
  // server refuses it anyway, and offering a button that always fails is worse
  // than offering none.
  const showApprove = canApprove && pending && !isSubmitter;
  const showPo = canProcure && approved;
  const showCancel = isSubmitter && pending;
  // Only a dead request, and only the person whose list it clutters.
  const showDelete = isSubmitter && ["rejected", "cancelled"].includes(status);

  if (!showApprove && !showPo && !showCancel && !showDelete) {
    return info || err ? <Messages info={info} err={err} /> : null;
  }

  return (
    <div className="mt-6 rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap gap-2">
        {showApprove && (
          <>
            <form action={approve}>
              <input type="hidden" name="id" value={id} />
              <button
                disabled={approving}
                className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                {approving ? "Approving…" : "Approve"}
              </button>
            </form>
            <button
              type="button"
              onClick={() => setOpen(open === "reject" ? null : "reject")}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              Reject
            </button>
          </>
        )}

        {showPo && (
          <button
            type="button"
            onClick={() => setOpen(open === "po" ? null : "po")}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
          >
            Record the PO
          </button>
        )}

        {showDelete && (
          <button
            type="button"
            onClick={() => setOpen(open === "delete" ? null : "delete")}
            className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/40"
          >
            Delete
          </button>
        )}

        {showCancel && (
          <form action={cancel}>
            <input type="hidden" name="id" value={id} />
            <button
              disabled={cancelling}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              {cancelling ? "Withdrawing…" : "Withdraw"}
            </button>
          </form>
        )}
      </div>

      {open === "reject" && (
        <form action={reject} className="mt-3">
          <input type="hidden" name="id" value={id} />
          <input
            name="reason"
            required
            minLength={3}
            placeholder="Why is it being rejected? The person who raised it will see this."
            className={FIELD}
          />
          <div className="mt-2 flex gap-2">
            <button disabled={rejecting} className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-60">
              {rejecting ? "Rejecting…" : "Reject"}
            </button>
            <button type="button" onClick={() => setOpen(null)} className="rounded-md px-3 py-1.5 text-xs font-medium text-zinc-500">
              Cancel
            </button>
          </div>
        </form>
      )}

      {open === "delete" && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950/30">
          <p className="text-xs text-red-900 dark:text-red-100">
            This removes the request and anything attached to it, for good.
          </p>
          <form action={del} className="mt-2 flex gap-2">
            <input type="hidden" name="id" value={id} />
            <button disabled={deleting} className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-60">
              {deleting ? "Deleting…" : "Yes, delete it"}
            </button>
            <button type="button" onClick={() => setOpen(null)} className="rounded-md px-3 py-1.5 text-xs font-medium text-zinc-500">
              Keep it
            </button>
          </form>
        </div>
      )}

      {open === "po" && (
        <form action={recordPo} className="mt-3 space-y-2">
          <input type="hidden" name="id" value={id} />
          <input name="po_reference" required placeholder="PO number" className={FIELD} />
          <select name="po_vendor_id" defaultValue="" className={FIELD}>
            <option value="">Vendor (optional — can be set on the payment request)</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>
          <div className="flex gap-2">
            <button disabled={recordingPo} className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
              {recordingPo ? "Saving…" : "Save PO"}
            </button>
            <button type="button" onClick={() => setOpen(null)} className="rounded-md px-3 py-1.5 text-xs font-medium text-zinc-500">
              Cancel
            </button>
          </div>
        </form>
      )}

      <Messages info={info} err={err} />
    </div>
  );
}

function Messages({ info, err }: { info?: string; err?: string }) {
  return (
    <>
      {info && <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-300">{info}</p>}
      {err && <p className="mt-2 text-xs text-red-700 dark:text-red-300">{err}</p>}
    </>
  );
}
