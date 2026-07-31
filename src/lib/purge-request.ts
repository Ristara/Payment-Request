import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * What deleting a request would destroy, so a confirmation can name it
 * instead of asking "are you sure?" about an unknown quantity.
 */
export type DeletionImpact = {
  requestId: string;
  requestNumber: string;
  title: string | null;
  vendorName: string | null;
  submitterEmail: string | null;
  installmentCount: number;
  totalRequested: number;
  totalPaid: number;
  statuses: string[];
  attachmentCount: number;
};

type Admin = ReturnType<typeof createAdminClient>;

const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

export async function getDeletionImpact(
  admin: Admin,
  requestId: string,
): Promise<DeletionImpact | null> {
  const [reqRes, instRes, payRes, attRes] = await Promise.all([
    admin
      .from("payment_requests")
      .select(
        "request_number, title, vendor:vendors(name), submitter:profiles!payment_requests_submitter_id_fkey(email)",
      )
      .eq("id", requestId)
      .maybeSingle(),
    admin.from("request_installments").select("status, requested_amount").eq("request_id", requestId),
    admin.from("payment_records").select("paid_amount").eq("request_id", requestId),
    admin.from("attachments").select("id", { count: "exact", head: true }).eq("request_id", requestId),
  ]);

  const req = reqRes.data as {
    request_number: string;
    title: string | null;
    vendor: { name: string } | { name: string }[] | null;
    submitter: { email: string } | { email: string }[] | null;
  } | null;
  if (!req) return null;

  const insts = (instRes.data ?? []) as { status: string; requested_amount: number }[];
  const pays = (payRes.data ?? []) as { paid_amount: number }[];

  return {
    requestId,
    requestNumber: req.request_number,
    title: req.title,
    vendorName: one(req.vendor)?.name ?? null,
    submitterEmail: one(req.submitter)?.email ?? null,
    installmentCount: insts.length,
    totalRequested: insts.reduce((s, i) => s + Number(i.requested_amount ?? 0), 0),
    totalPaid: pays.reduce((s, p) => s + Number(p.paid_amount ?? 0), 0),
    statuses: Array.from(new Set(insts.map((i) => i.status))),
    attachmentCount: attRes.count ?? 0,
  };
}

/**
 * Permanently delete a request and everything hanging off it.
 *
 * Every child table cascades, so one delete takes the installments, line
 * items, comments, notifications, status history, audit log AND payment
 * records with it. There is no undo.
 *
 * Two things have to happen before the row goes. A tombstone is written to
 * deleted_requests — which holds no foreign key back to payment_requests,
 * precisely so it survives what it describes. And the attachment blobs are
 * removed from storage, which cascade does not reach: dropping the rows that
 * point at those files would orphan them in the bucket forever.
 *
 * Returns an error string, or null on success.
 */
export async function purgeRequest(
  admin: Admin,
  requestId: string,
  actor: { id: string; email: string | null },
  reason: string | null,
): Promise<string | null> {
  const impact = await getDeletionImpact(admin, requestId);
  if (!impact) return "That request no longer exists.";

  // Storage first. If this fails we stop — better a request that still exists
  // than files no row will ever point to again.
  const { data: atts } = await admin
    .from("attachments")
    .select("storage_path")
    .eq("request_id", requestId);
  const paths = ((atts ?? []) as { storage_path: string }[])
    .map((a) => a.storage_path)
    .filter(Boolean);
  if (paths.length > 0) {
    const { error: rmErr } = await admin.storage.from("request-attachments").remove(paths);
    if (rmErr) return `Couldn't remove the attached files: ${rmErr.message}`;
  }

  await admin.from("deleted_requests").insert({
    request_number: impact.requestNumber,
    title: impact.title,
    vendor_name: impact.vendorName,
    submitter_email: impact.submitterEmail,
    installment_count: impact.installmentCount,
    total_requested: impact.totalRequested,
    total_paid: impact.totalPaid,
    statuses: impact.statuses.join(", "),
    attachment_count: impact.attachmentCount,
    reason,
    deleted_by: actor.id,
    deleted_by_email: actor.email,
  });

  const { error } = await admin.from("payment_requests").delete().eq("id", requestId);
  return error ? error.message : null;
}

/** Requests raised by this user that haven't finished their journey yet. */
const TERMINAL = ["closed", "rejected", "cancelled"];

export async function getOpenRequestsFor(
  admin: Admin,
  userId: string,
): Promise<Array<{ id: string; requestNumber: string; title: string | null; amount: number; statuses: string[] }>> {
  const { data } = await admin
    .from("payment_requests")
    .select("id, request_number, title, request_installments(status, requested_amount)")
    .eq("submitter_id", userId)
    .order("created_at", { ascending: false });

  const rows = (data ?? []) as Array<{
    id: string;
    request_number: string;
    title: string | null;
    request_installments: { status: string; requested_amount: number }[];
  }>;

  return rows
    .map((r) => {
      const live = (r.request_installments ?? []).filter((i) => !TERMINAL.includes(i.status));
      return {
        id: r.id,
        requestNumber: r.request_number,
        title: r.title,
        amount: live.reduce((s, i) => s + Number(i.requested_amount ?? 0), 0),
        statuses: Array.from(new Set(live.map((i) => i.status))),
        live: live.length,
      };
    })
    .filter((r) => r.live > 0)
    .map(({ ...r }) => ({
      id: r.id,
      requestNumber: r.requestNumber,
      title: r.title,
      amount: r.amount,
      statuses: r.statuses,
    }));
}
