"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendPushToUsers } from "@/lib/push";
import { computeRollupIds } from "@/lib/coa";

export type RequestState = { error?: string; info?: string } | undefined;

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatShortAmount(n: number): string {
  return "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

function formatExactAmount(n: number): string {
  return "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function currentUserOrThrow() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  return { supabase, user };
}

// ---------------------------------------------------------------------------
// createThread — used by /requests/new
//
// Creates a new thread (payment_requests row) plus its first installment
// in one shot. The thread carries vendor + doc + line items (= PO value);
// installment #1 carries the "release ₹X" ask with its own approval flow.
// ---------------------------------------------------------------------------

export async function createThread(
  _prev: RequestState,
  formData: FormData,
): Promise<RequestState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const vendor_id = String(formData.get("vendor_id") ?? "");
  const outlet_ids = formData.getAll("outlet_ids").map((s) => String(s)).filter(Boolean);
  const document_type = String(formData.get("document_type") ?? "") as
    | "po" | "invoice" | "no_invoice" | "invoice_pending" | "";
  const document_reference = String(formData.get("document_reference") ?? "").trim() || null;
  const installment_amount = Number(formData.get("installment_amount") ?? 0);
  const payment_due_date = String(formData.get("payment_due_date") ?? "");
  const date_of_work_completion = String(formData.get("date_of_work_completion") ?? "") || null;
  const tentative_invoice_date = String(formData.get("tentative_invoice_date") ?? "") || null;

  const linesRaw = String(formData.get("line_items") ?? "[]");
  type LineIn = { coa_account_id: string; quantity: number; rate: number };
  let lines: LineIn[] = [];
  try {
    lines = JSON.parse(linesRaw) as LineIn[];
  } catch {
    return { error: "Invalid line items payload." };
  }
  const purpose = String(formData.get("purpose") ?? "").trim();
  const files = formData.getAll("attachments").filter((f): f is File => f instanceof File && f.size > 0);

  // ------ Validation ------
  if (!vendor_id) return { error: "Pick a vendor." };
  if (outlet_ids.length === 0) return { error: "Pick at least one outlet." };
  if (!installment_amount || installment_amount <= 0) return { error: "First installment amount must be positive." };
  if (!payment_due_date) return { error: "Payment due date is required." };
  if (!document_type) return { error: "Pick a document type." };
  if ((document_type === "po" || document_type === "invoice") && !document_reference) {
    return { error: `Enter the ${document_type === "po" ? "PO" : "invoice"} number.` };
  }
  const tentativeRequired = document_type === "po" || document_type === "invoice_pending";
  if (tentativeRequired && !tentative_invoice_date) {
    return { error: "Tentative invoice date is required for PO / Invoice yet to receive." };
  }
  if (lines.length === 0) return { error: "Add at least one line item." };
  const badLine = lines.findIndex((l) => !l.coa_account_id || !(l.quantity > 0) || !(l.rate >= 0));
  if (badLine !== -1) return { error: `Line ${badLine + 1}: subcategory + quantity + rate all required.` };

  const poValue = Math.round(lines.reduce((s, l) => s + l.quantity * l.rate, 0) * 100) / 100;
  if (poValue <= 0) return { error: "PO value must be positive." };
  if (installment_amount - poValue > 0.005) {
    return {
      error: `First installment ${formatExactAmount(installment_amount)} can't exceed PO value ${formatExactAmount(poValue)}.`,
    };
  }
  if (!purpose) return { error: "Purpose / description is required." };

  // ------ CoA validation (existence + rollup guard) ------
  const uniqueCoaIds = Array.from(new Set(lines.map((l) => l.coa_account_id)));
  const { data: pickedRows } = await supabase
    .from("coa_accounts")
    .select("id, subcategory, category, coa")
    .in("id", uniqueCoaIds);
  if ((pickedRows?.length ?? 0) !== uniqueCoaIds.length) {
    return { error: "One or more selected accounts don't exist." };
  }
  const coaHeadsInPlay = Array.from(new Set((pickedRows ?? []).map((r) => r.coa as string)));
  const { data: siblingRows } = await supabase
    .from("coa_accounts")
    .select("id, subcategory, category, coa")
    .in("coa", coaHeadsInPlay)
    .eq("is_active", true);
  const rollups = computeRollupIds((siblingRows ?? []) as { id: string; subcategory: string; category: string; coa: string }[]);
  const badRollup = (pickedRows ?? []).find((r) => rollups.has(r.id as string));
  if (badRollup) {
    return {
      error: `"${badRollup.subcategory}" is a group / rollup, not a spendable subcategory. Pick one of its child subcategories instead.`,
    };
  }

  // ------ Vendor sanity ------
  const { data: vendor } = await supabase
    .from("vendors")
    .select("status")
    .eq("id", vendor_id)
    .single();
  if (!vendor) return { error: "Vendor not found." };
  if (vendor.status === "rejected") return { error: "This vendor was rejected. Pick a different vendor." };

  // ------ Reserve request number ------
  const admin = createAdminClient();
  const reserved = String(formData.get("request_number") ?? "").trim();
  let requestNumber =
    reserved || `PR-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 99999)).padStart(5, "0")}`;
  if (!reserved) {
    const { data: seqRow, error: seqErr } = await admin.rpc("next_request_number");
    if (!seqErr && typeof seqRow === "string" && seqRow.length > 0) requestNumber = seqRow;
    else console.error("[createThread] next_request_number RPC failed:", seqErr?.message);
  }

  // ------ Insert thread ------
  const { data: inserted, error } = await supabase
    .from("payment_requests")
    .insert({
      request_number: requestNumber,
      submitter_id: user.id,
      vendor_id,
      document_type,
      document_reference:
        document_type === "po" || document_type === "invoice" ? document_reference : null,
      purpose,
    })
    .select("id, request_number")
    .single();
  if (error || !inserted) {
    console.error("[createThread] thread insert failed:", error);
    return { error: error?.message ?? "Failed to create request." };
  }
  const requestId = inserted.id as string;

  // ------ Outlets ------
  const { error: outletsErr } = await supabase.from("request_outlets").insert(
    outlet_ids.map((outlet_id) => ({ request_id: requestId, outlet_id })),
  );
  if (outletsErr) {
    console.error("[createThread] outlets insert failed:", outletsErr);
    await admin.from("payment_requests").delete().eq("id", requestId);
    return { error: `Couldn't save outlets: ${outletsErr.message}` };
  }

  // ------ Line items (the PO breakdown) ------
  const { error: linesErr } = await supabase.from("request_line_items").insert(
    lines.map((l, idx) => ({
      request_id: requestId,
      coa_account_id: l.coa_account_id,
      quantity: l.quantity,
      rate: l.rate,
      sort_order: idx,
    })),
  );
  if (linesErr) {
    console.error("[createThread] lines insert failed:", linesErr);
    await admin.from("payment_requests").delete().eq("id", requestId);
    return { error: `Couldn't save line items: ${linesErr.message}` };
  }

  // ------ First installment ------
  const { data: firstInst, error: instErr } = await supabase
    .from("request_installments")
    .insert({
      request_id: requestId,
      installment_number: 1,
      requested_amount: installment_amount,
      payment_due_date,
      date_of_work_completion,
      tentative_invoice_date: tentativeRequired ? tentative_invoice_date : null,
      purpose: null, // installment-specific note; blank for #1
      status: "pending_approval",
      submitted_by: user.id,
    })
    .select("id")
    .single();
  if (instErr || !firstInst) {
    console.error("[createThread] first installment insert failed:", instErr);
    await admin.from("payment_requests").delete().eq("id", requestId);
    return { error: `Couldn't save installment: ${instErr?.message}` };
  }
  const firstInstallmentId = firstInst.id as string;

  // Status history
  await admin.from("status_history").insert({
    request_id: requestId,
    installment_id: firstInstallmentId,
    actor_id: user.id,
    from_status: null,
    to_status: "pending_approval",
    comment: `Installment #1 raised (${formatExactAmount(installment_amount)} of ${formatExactAmount(poValue)})`,
  });

  // ------ Attachments (thread-level) ------
  if (files.length > 0) {
    const rows: Array<Record<string, unknown>> = [];
    for (const file of files) {
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${requestId}/request/${Date.now()}-${safe}`;
      const buf = await file.arrayBuffer();
      const { error: uploadErr } = await admin.storage
        .from("request-attachments")
        .upload(path, buf, { contentType: file.type || "application/octet-stream" });
      if (uploadErr) continue;
      rows.push({
        request_id: requestId,
        stage: "request",
        storage_path: path,
        file_name: file.name,
        file_size_bytes: file.size,
        mime_type: file.type || null,
        uploaded_by: user.id,
      });
    }
    if (rows.length > 0) await admin.from("attachments").insert(rows);
  }

  // ------ Notifications to approvers ------
  await notifyApprovers({
    requestId,
    requestNumber,
    installmentAmount: installment_amount,
    installmentNumber: 1,
    actorId: user.id,
  });

  revalidatePath("/requests");
  revalidatePath("/approvals");
  redirect(`/requests/${requestId}`);
}

// ---------------------------------------------------------------------------
// raiseInstallment — 2nd/3rd/… installment on an existing thread
// ---------------------------------------------------------------------------

export async function raiseInstallment(
  _prev: RequestState,
  formData: FormData,
): Promise<RequestState> {
  const requestId = String(formData.get("request_id") ?? "");
  const requestedAmount = Number(formData.get("requested_amount") ?? 0);
  const paymentDueDate = String(formData.get("payment_due_date") ?? "");
  const dateOfWorkCompletion = String(formData.get("date_of_work_completion") ?? "") || null;
  const noteRaw = String(formData.get("purpose") ?? "").trim();
  const purposeNote = noteRaw || null;
  const files = formData.getAll("attachments").filter((f): f is File => f instanceof File && f.size > 0);

  if (!requestId) return { error: "Missing thread." };
  if (!requestedAmount || requestedAmount <= 0) return { error: "Installment amount must be positive." };
  if (!paymentDueDate) return { error: "Payment due date is required." };

  const supabase = await createClient();
  const admin = createAdminClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  // Thread + line items + prior installments (for balance check)
  const [threadRes, linesRes, instRes] = await Promise.all([
    supabase.from("payment_requests").select("id, request_number, submitter_id, document_type").eq("id", requestId).single(),
    supabase.from("request_line_items").select("quantity, rate").eq("request_id", requestId),
    supabase.from("request_installments").select("requested_amount, status, tentative_invoice_date").eq("request_id", requestId),
  ]);
  if (!threadRes.data) return { error: "Thread not found." };

  const poValue = Math.round((linesRes.data ?? []).reduce((s, l) => s + Number(l.quantity) * Number(l.rate), 0) * 100) / 100;
  const nonCancelledInstallments = (instRes.data ?? []).filter((i) => i.status !== "cancelled" && i.status !== "rejected");
  const alreadyRequested = nonCancelledInstallments.reduce((s, i) => s + Number(i.requested_amount), 0);
  const remaining = Math.round((poValue - alreadyRequested) * 100) / 100;

  if (requestedAmount - remaining > 0.005) {
    return {
      error: `Only ${formatExactAmount(remaining)} left on this PO (${formatExactAmount(poValue)} total, ${formatExactAmount(alreadyRequested)} already requested). Raise a new thread if scope has grown.`,
    };
  }

  const nextNumber = (instRes.data?.length ?? 0) + 1;
  // Preserve tentative_invoice_date from the FIRST installment (PO doc-type
  // context doesn't change mid-thread).
  const firstTentative = (instRes.data ?? []).find((i) => i.tentative_invoice_date)?.tentative_invoice_date ?? null;

  const { data: inst, error: instErr } = await supabase
    .from("request_installments")
    .insert({
      request_id: requestId,
      installment_number: nextNumber,
      requested_amount: requestedAmount,
      payment_due_date: paymentDueDate,
      date_of_work_completion: dateOfWorkCompletion,
      tentative_invoice_date: firstTentative,
      purpose: purposeNote,
      status: "pending_approval",
      submitted_by: user.id,
    })
    .select("id")
    .single();
  if (instErr || !inst) return { error: instErr?.message ?? "Failed to raise installment." };
  const instId = inst.id as string;

  await admin.from("status_history").insert({
    request_id: requestId,
    installment_id: instId,
    actor_id: user.id,
    from_status: null,
    to_status: "pending_approval",
    comment: `Installment #${nextNumber} raised (${formatExactAmount(requestedAmount)})`,
  });

  // Attachments — for this specific installment; stored under request path, tagged stage=installment
  if (files.length > 0) {
    const rows: Array<Record<string, unknown>> = [];
    for (const file of files) {
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${requestId}/installments/${instId}/${Date.now()}-${safe}`;
      const buf = await file.arrayBuffer();
      const { error: uploadErr } = await admin.storage
        .from("request-attachments")
        .upload(path, buf, { contentType: file.type || "application/octet-stream" });
      if (uploadErr) continue;
      rows.push({
        request_id: requestId,
        stage: "request",
        storage_path: path,
        file_name: file.name,
        file_size_bytes: file.size,
        mime_type: file.type || null,
        uploaded_by: user.id,
      });
    }
    if (rows.length > 0) await admin.from("attachments").insert(rows);
  }

  await notifyApprovers({
    requestId,
    requestNumber: threadRes.data.request_number as string,
    installmentAmount: requestedAmount,
    installmentNumber: nextNumber,
    actorId: user.id,
  });

  revalidatePath(`/requests/${requestId}`);
  revalidatePath("/approvals");
  return { info: `Installment #${nextNumber} submitted for approval.` };
}

// ---------------------------------------------------------------------------
// Installment transitions (per-installment approval → payment → close)
// ---------------------------------------------------------------------------

async function transitionInstallment(
  installmentId: string,
  to: string,
  comment: string | null,
  extra: Record<string, unknown> = {},
) {
  const admin = createAdminClient();
  const { supabase, user } = await currentUserOrThrow();

  const { data: inst } = await admin
    .from("request_installments")
    .select("id, request_id, installment_number, status, requested_amount")
    .eq("id", installmentId)
    .single();
  if (!inst) throw new Error("Installment not found.");
  const from = inst.status as string;

  // Legal from-states per target. A stale form / crafted POST can't approve a
  // cancelled installment or re-pay a closed one.
  const ALLOWED_FROM: Record<string, string[]> = {
    approved: ["pending_approval", "clarification_required"],
    rejected: ["pending_approval", "clarification_required"],
    returned_for_correction: ["pending_approval", "clarification_required"],
    clarification_required: ["pending_approval"],
    pending_approval: ["clarification_required", "returned_for_correction"],
    uploaded_in_bank: ["approved"],
    invoice_pending: ["uploaded_in_bank", "approved"],
    payment_processed: ["uploaded_in_bank", "approved", "invoice_pending"],
    closed: ["invoice_pending", "payment_processed"],
    cancelled: ["pending_approval", "clarification_required", "returned_for_correction", "approved"],
  };
  const legal = ALLOWED_FROM[to];
  if (legal && !legal.includes(from)) {
    throw new Error(
      `Can't move installment #${inst.installment_number} from "${from.replace(/_/g, " ")}" to "${to.replace(/_/g, " ")}". Refresh the page — its status has changed.`,
    );
  }

  // Guarded update: the WHERE clause re-checks status so a concurrent
  // transition between our read and this write can't double-apply.
  const { data: updated, error } = await supabase
    .from("request_installments")
    .update({ status: to, ...extra })
    .eq("id", installmentId)
    .eq("status", from)
    .select("id");
  if (error) throw error;
  if (!updated || updated.length === 0) {
    throw new Error("Installment status changed while you were acting. Refresh and retry.");
  }

  await admin.from("status_history").insert({
    request_id: inst.request_id,
    installment_id: installmentId,
    actor_id: user.id,
    from_status: from,
    to_status: to,
    comment,
  });

  // Notifications on notable transitions
  const notifiableKinds: Record<string, string> = {
    approved: "request_approved",
    rejected: "request_rejected",
    returned_for_correction: "request_returned",
    payment_processed: "payment_processed",
    invoice_pending: "invoice_reminder",
    closed: "request_closed",
  };
  if (notifiableKinds[to]) {
    const { data: thread } = await admin
      .from("payment_requests")
      .select("submitter_id, request_number")
      .eq("id", inst.request_id)
      .single();
    if (thread && thread.submitter_id !== user.id) {
      const { data: actor } = await admin.from("profiles").select("full_name").eq("id", user.id).single();
      await admin.from("notifications").insert({
        recipient_id: thread.submitter_id,
        actor_id: user.id,
        kind: notifiableKinds[to],
        request_id: inst.request_id,
        body: `${thread.request_number} · installment #${inst.installment_number} → ${to.replace(/_/g, " ")}`,
      });
      await sendPushToUsers([thread.submitter_id], {
        title: `${actor?.full_name ?? "Someone"} ${to.replace(/_/g, " ")} installment #${inst.installment_number}`,
        body: `${thread.request_number}${comment ? " · " + comment.slice(0, 100) : ""}`,
        url: `/requests/${inst.request_id}`,
        tag: `request-${inst.request_id}`,
      });
    }
    if (to === "approved") {
      const { data: acc } = await admin.from("user_roles").select("user_id").eq("role", "accounts");
      const accIds = ((acc ?? []) as { user_id: string }[]).map((r) => r.user_id).filter((id) => id !== user.id);
      if (accIds.length > 0) {
        const { data: t } = await admin.from("payment_requests").select("request_number").eq("id", inst.request_id).single();
        await admin.from("notifications").insert(accIds.map((recipient_id) => ({
          recipient_id,
          actor_id: user.id,
          kind: "ready_for_payment",
          request_id: inst.request_id,
          body: `${t?.request_number} · installment #${inst.installment_number} ready`,
        })));
        await sendPushToUsers(accIds, {
          title: "Installment ready for payment",
          body: `${t?.request_number} · installment #${inst.installment_number}`,
          url: `/requests/${inst.request_id}`,
          tag: `request-${inst.request_id}`,
        });
      }
    }
  }
  return inst;
}

async function notifyApprovers(args: {
  requestId: string;
  requestNumber: string;
  installmentAmount: number;
  installmentNumber: number;
  actorId: string;
}) {
  const admin = createAdminClient();
  const { data: approvers } = await admin.from("user_roles").select("user_id").eq("role", "approver");
  const approverIds = ((approvers ?? []) as { user_id: string }[])
    .map((r) => r.user_id)
    .filter((id) => id !== args.actorId);
  if (approverIds.length === 0) return;
  await admin.from("notifications").insert(
    approverIds.map((recipient_id) => ({
      recipient_id,
      actor_id: args.actorId,
      kind: "request_submitted",
      request_id: args.requestId,
      body: `${args.requestNumber} · installment #${args.installmentNumber} · ${formatShortAmount(args.installmentAmount)}`,
    })),
  );
  const { data: submitter } = await admin.from("profiles").select("full_name").eq("id", args.actorId).single();
  await sendPushToUsers(approverIds, {
    title: `Installment #${args.installmentNumber} from ${submitter?.full_name ?? "someone"}`,
    body: `${args.requestNumber} · ${formatShortAmount(args.installmentAmount)}`,
    url: `/requests/${args.requestId}`,
    tag: `request-${args.requestId}`,
  });
}

export async function approveInstallment(
  _prev: RequestState,
  formData: FormData,
): Promise<RequestState> {
  const installmentId = String(formData.get("installment_id") ?? "");
  if (!installmentId) return { error: "Missing installment." };
  try {
    const { user } = await currentUserOrThrow();
    const inst = await transitionInstallment(installmentId, "approved", null, {
      approver_id: user.id,
      approved_at: new Date().toISOString(),
    });
    revalidatePath(`/requests/${inst.request_id}`);
    revalidatePath("/approvals");
    return { info: "Approved." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function rejectInstallment(
  _prev: RequestState,
  formData: FormData,
): Promise<RequestState> {
  const installmentId = String(formData.get("installment_id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!installmentId) return { error: "Missing installment." };
  if (!reason) return { error: "Reason is required." };
  try {
    const inst = await transitionInstallment(installmentId, "rejected", reason, { rejection_reason: reason });
    revalidatePath(`/requests/${inst.request_id}`);
    revalidatePath("/approvals");
    return { info: "Rejected." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function returnInstallment(
  _prev: RequestState,
  formData: FormData,
): Promise<RequestState> {
  const installmentId = String(formData.get("installment_id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!installmentId) return { error: "Missing installment." };
  if (!reason) return { error: "Reason is required." };
  try {
    const inst = await transitionInstallment(installmentId, "returned_for_correction", reason, {
      return_reason: reason,
    });
    revalidatePath(`/requests/${inst.request_id}`);
    revalidatePath("/approvals");
    return { info: "Returned for correction." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function cancelInstallment(
  _prev: RequestState,
  formData: FormData,
): Promise<RequestState> {
  const installmentId = String(formData.get("installment_id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!installmentId || !reason) return { error: "Reason is required." };
  try {
    const inst = await transitionInstallment(installmentId, "cancelled", reason, {
      cancelled_at: new Date().toISOString(),
      cancellation_reason: reason,
    });
    revalidatePath(`/requests/${inst.request_id}`);
    return { info: "Cancelled." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

// ---------------------------------------------------------------------------
// Change COA on a line item (Approver / Accounts / Admin)
// Line items are thread-scoped; the change applies to every installment that
// references this thread's PO breakdown.
// ---------------------------------------------------------------------------

export async function updateLineCoa(
  _prev: RequestState,
  formData: FormData,
): Promise<RequestState> {
  const lineId = String(formData.get("line_id") ?? "");
  const requestId = String(formData.get("request_id") ?? "");
  const newCoaId = String(formData.get("coa_account_id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!lineId || !requestId || !newCoaId || !reason) {
    return { error: "New account + reason required." };
  }

  const supabase = await createClient();
  const admin = createAdminClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { data: line } = await supabase
    .from("request_line_items").select("coa_account_id").eq("id", lineId).single();
  if (!line) return { error: "Line not found." };
  if ((line.coa_account_id as string) === newCoaId) return { info: "Account unchanged." };

  const { data: target } = await supabase
    .from("coa_accounts")
    .select("id, subcategory, category, coa, is_active")
    .eq("id", newCoaId).single();
  if (!target) return { error: "Target account not found." };
  if (!target.is_active) return { error: "That account is inactive. Pick an active one." };
  const { data: siblings } = await supabase
    .from("coa_accounts")
    .select("id, subcategory, category, coa")
    .eq("coa", target.coa).eq("is_active", true);
  const rollups = computeRollupIds((siblings ?? []) as { id: string; subcategory: string; category: string; coa: string }[]);
  if (rollups.has(target.id as string)) {
    return {
      error: `"${target.subcategory}" is a group / rollup, not a spendable subcategory. Pick one of its child subcategories instead.`,
    };
  }

  const { error: upErr } = await supabase
    .from("request_line_items").update({ coa_account_id: newCoaId }).eq("id", lineId);
  if (upErr) return { error: upErr.message };

  await admin.from("coa_override_log").insert({
    request_id: requestId,
    actor_id: user.id,
    reason: `Line reclassified: ${reason}`,
  });

  revalidatePath(`/requests/${requestId}`);
  return { info: "Line updated." };
}

// ---------------------------------------------------------------------------
// Accounts: bank upload / mark paid / mark invoice / close — all per installment
// ---------------------------------------------------------------------------

export async function markInstallmentBankUploaded(
  _prev: RequestState,
  formData: FormData,
): Promise<RequestState> {
  const installmentId = String(formData.get("installment_id") ?? "");
  const bank_upload_date = String(formData.get("bank_upload_date") ?? "");
  const bank_batch_ref = String(formData.get("bank_batch_ref") ?? "").trim() || null;
  if (!installmentId || !bank_upload_date) return { error: "Bank upload date is required." };

  const supabase = await createClient();
  const admin = createAdminClient();

  // Vendor must still be approved before money moves — approval could have
  // been granted before the vendor was later rejected.
  const { data: instRow } = await admin
    .from("request_installments")
    .select("request_id, request:payment_requests(vendor:vendors(status))")
    .eq("id", installmentId)
    .single();
  type VendorJoin = { request: { vendor: { status: string } | null } | { vendor: { status: string } | null }[] | null };
  const reqJoin = (instRow as unknown as VendorJoin | null)?.request;
  const vendorStatus = (Array.isArray(reqJoin) ? reqJoin[0]?.vendor : reqJoin?.vendor)?.status;
  if (vendorStatus !== "approved") {
    return { error: "Vendor is not approved. Verify the vendor before uploading to bank." };
  }

  try {
    // Transition FIRST — the state machine rejects wrong from-states, and we
    // only write the payment record once the move is legal.
    const inst = await transitionInstallment(installmentId, "uploaded_in_bank", "Marked uploaded in bank");
    await supabase
      .from("payment_records")
      .upsert({ installment_id: installmentId, bank_upload_date, bank_batch_ref }, { onConflict: "installment_id" });
    revalidatePath(`/requests/${inst.request_id}`);
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath("/accounts");
  return { info: "Marked as uploaded in bank." };
}

export async function markInstallmentPaid(
  _prev: RequestState,
  formData: FormData,
): Promise<RequestState> {
  const installmentId = String(formData.get("installment_id") ?? "");
  const payment_date = String(formData.get("payment_date") ?? "");
  const paid_amount = Number(formData.get("paid_amount") ?? 0);
  const utr_reference = String(formData.get("utr_reference") ?? "").trim();
  const paying_bank_account = String(formData.get("paying_bank_account") ?? "").trim() || null;
  const proof = formData.get("proof");
  if (!installmentId || !payment_date || !paid_amount || !utr_reference) {
    return { error: "Payment date, amount, and UTR are all required." };
  }

  const supabase = await createClient();
  const admin = createAdminClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { data: inst } = await admin
    .from("request_installments")
    .select("id, request_id, status, request:payment_requests(vendor:vendors(status))")
    .eq("id", installmentId)
    .single();
  if (!inst) return { error: "Installment not found." };

  // Status gate BEFORE writing anything — a stale form on an already-paid or
  // closed installment must not overwrite the real payment record.
  if (!["uploaded_in_bank", "approved"].includes(inst.status as string)) {
    return { error: `Installment is "${String(inst.status).replace(/_/g, " ")}" — can't record payment. Refresh the page.` };
  }
  type VendorJoin = { vendor: { status: string } | null } | { vendor: { status: string } | null }[] | null;
  const reqJoin = (inst as unknown as { request: VendorJoin }).request;
  const vendorStatus = (Array.isArray(reqJoin) ? reqJoin[0]?.vendor : reqJoin?.vendor)?.status;
  if (vendorStatus !== "approved") {
    return { error: "Vendor is not approved. Verify the vendor before recording payment." };
  }

  await supabase
    .from("payment_records")
    .upsert({
      installment_id: installmentId,
      request_id: inst.request_id,
      payment_date,
      paid_amount,
      utr_reference,
      paying_bank_account,
      recorded_by: user.id,
    }, { onConflict: "installment_id" });

  if (proof instanceof File && proof.size > 0) {
    const safe = proof.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${inst.request_id}/installments/${installmentId}/payment/${Date.now()}-${safe}`;
    const buf = await proof.arrayBuffer();
    const { error: uploadErr } = await admin.storage
      .from("request-attachments")
      .upload(path, buf, { contentType: proof.type || "application/octet-stream" });
    if (!uploadErr) {
      await admin.from("attachments").insert({
        request_id: inst.request_id,
        stage: "payment",
        storage_path: path,
        file_name: proof.name,
        file_size_bytes: proof.size,
        mime_type: proof.type || null,
        uploaded_by: user.id,
      });
    }
  }

  try {
    // Invoice must belong to THIS installment — the storage path embeds the
    // installment id (…/installments/<id>/invoice/…), so filter on it.
    // A thread-mate's invoice must not skip this installment past
    // invoice_pending.
    const { count: invCount } = await admin
      .from("attachments")
      .select("id", { count: "exact", head: true })
      .eq("request_id", inst.request_id)
      .eq("stage", "invoice")
      .like("storage_path", `%/installments/${installmentId}/%`);
    const nextStatus = (invCount ?? 0) > 0 ? "payment_processed" : "invoice_pending";
    await transitionInstallment(installmentId, nextStatus, "Payment processed");
  } catch (e) {
    return { error: (e as Error).message };
  }

  revalidatePath(`/requests/${inst.request_id}`);
  revalidatePath("/accounts");
  return { info: "Payment recorded." };
}

export async function uploadInstallmentInvoice(
  _prev: RequestState,
  formData: FormData,
): Promise<RequestState> {
  const installmentId = String(formData.get("installment_id") ?? "");
  const invoice = formData.get("invoice");
  if (!installmentId || !(invoice instanceof File) || invoice.size === 0) {
    return { error: "Pick an invoice file." };
  }

  const admin = createAdminClient();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { data: inst } = await admin
    .from("request_installments").select("id, request_id").eq("id", installmentId).single();
  if (!inst) return { error: "Installment not found." };

  // Only the thread's submitter, accounts, or admin may attach invoices.
  const { data: thread } = await admin
    .from("payment_requests").select("submitter_id").eq("id", inst.request_id).single();
  const { data: roleRows } = await supabase
    .from("user_roles").select("role").eq("user_id", user.id);
  const roles = new Set(((roleRows ?? []) as { role: string }[]).map((r) => r.role));
  const allowed =
    thread?.submitter_id === user.id || roles.has("accounts") || roles.has("admin");
  if (!allowed) return { error: "Only the submitter or Accounts can upload the invoice." };

  const safe = invoice.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${inst.request_id}/installments/${installmentId}/invoice/${Date.now()}-${safe}`;
  const buf = await invoice.arrayBuffer();
  const { error: uploadErr } = await admin.storage
    .from("request-attachments")
    .upload(path, buf, { contentType: invoice.type || "application/octet-stream" });
  if (uploadErr) return { error: uploadErr.message };

  await admin.from("attachments").insert({
    request_id: inst.request_id,
    stage: "invoice",
    storage_path: path,
    file_name: invoice.name,
    file_size_bytes: invoice.size,
    mime_type: invoice.type || null,
    uploaded_by: user.id,
  });

  revalidatePath(`/requests/${inst.request_id}`);
  return { info: "Invoice uploaded." };
}

export async function closeInstallment(
  _prev: RequestState,
  formData: FormData,
): Promise<RequestState> {
  const installmentId = String(formData.get("installment_id") ?? "");
  if (!installmentId) return { error: "Missing installment." };
  try {
    const inst = await transitionInstallment(installmentId, "closed", "Verified and closed");
    revalidatePath(`/requests/${inst.request_id}`);
    revalidatePath("/accounts");
    return { info: "Closed." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

// ---------------------------------------------------------------------------
// Discussion (thread-level) — comments, questions, mentions
// ---------------------------------------------------------------------------

export async function addComment(
  _prev: RequestState,
  formData: FormData,
): Promise<RequestState> {
  const requestId = String(formData.get("request_id") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  const mentions = formData.getAll("mentions").map((s) => String(s)).filter(Boolean);
  const files = formData.getAll("attachments").filter((f): f is File => f instanceof File && f.size > 0);
  const isQuestion = formData.get("is_question") === "on";

  if (!requestId) return { error: "Missing request." };
  if (!body && files.length === 0) return { error: "Type a message or attach a file." };

  const supabase = await createClient();
  const admin = createAdminClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { data: inserted, error } = await supabase
    .from("comments")
    .insert({
      request_id: requestId,
      author_id: user.id,
      body: body || "(attachment)",
      is_question: isQuestion,
      question_state: isQuestion ? "open" : null,
    })
    .select("id")
    .single();
  if (error || !inserted) return { error: error?.message ?? "Failed." };

  const commentId = inserted.id as string;

  if (mentions.length > 0) {
    await admin.from("comment_mentions").insert(
      mentions.map((mentioned_user_id) => ({ comment_id: commentId, mentioned_user_id })),
    );
    await admin.from("notifications").insert(
      mentions.map((recipient_id) => ({
        recipient_id,
        actor_id: user.id,
        kind: "mentioned",
        request_id: requestId,
        body: body.slice(0, 140) || "(attachment)",
      })),
    );
    const { data: actor } = await admin.from("profiles").select("full_name").eq("id", user.id).single();
    await sendPushToUsers(mentions, {
      title: `${actor?.full_name ?? "Someone"} mentioned you`,
      body: body.slice(0, 140) || "(attachment)",
      url: `/requests/${requestId}`,
      tag: `request-${requestId}`,
    });
  }

  // A question pauses pending installments regardless of whether anyone was
  // @mentioned — the question itself is the blocker, not the mention.
  if (isQuestion) {
    const { data: pendingInsts } = await supabase
      .from("request_installments")
      .select("id, status")
      .eq("request_id", requestId)
      .eq("status", "pending_approval");
    for (const inst of pendingInsts ?? []) {
      try {
        await transitionInstallment(inst.id, "clarification_required", body.slice(0, 200));
      } catch { /* best-effort */ }
    }
  }

  if (files.length > 0) {
    const rows: Array<Record<string, unknown>> = [];
    for (const f of files) {
      const safe = f.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${requestId}/comments/${commentId}/${Date.now()}-${safe}`;
      const buf = await f.arrayBuffer();
      const { error: uploadErr } = await admin.storage
        .from("request-attachments")
        .upload(path, buf, { contentType: f.type || "application/octet-stream" });
      if (uploadErr) continue;
      rows.push({
        comment_id: commentId,
        stage: "comment",
        storage_path: path,
        file_name: f.name,
        file_size_bytes: f.size,
        mime_type: f.type || null,
        uploaded_by: user.id,
      });
    }
    if (rows.length > 0) await admin.from("attachments").insert(rows);
  }

  revalidatePath(`/requests/${requestId}`);
  return { info: "Sent." };
}

export async function setQuestionState(formData: FormData): Promise<void> {
  const commentId = String(formData.get("comment_id") ?? "");
  const state = String(formData.get("state") ?? "");
  const requestId = String(formData.get("request_id") ?? "");
  if (!commentId || !["open", "answered", "resolved"].includes(state)) return;
  const supabase = await createClient();
  await supabase.from("comments").update({ question_state: state }).eq("id", commentId);

  // Move clarification_required installments back to pending_approval when all
  // questions on the thread are non-open.
  if (requestId) {
    const { data: open } = await supabase
      .from("comments")
      .select("id", { count: "exact", head: true })
      .eq("request_id", requestId)
      .eq("is_question", true)
      .eq("question_state", "open");
    const stillOpen = ((open as unknown as { count?: number })?.count ?? 0) > 0;
    if (!stillOpen) {
      const { data: waiting } = await supabase
        .from("request_installments")
        .select("id")
        .eq("request_id", requestId)
        .eq("status", "clarification_required");
      for (const inst of waiting ?? []) {
        try {
          await transitionInstallment(inst.id, "pending_approval", "Clarifications resolved");
        } catch { /* best-effort */ }
      }
    }
  }
  revalidatePath(`/requests/${requestId}`);
}

// ---------------------------------------------------------------------------
// Thread read marker — powers unread badges on the request lists
// ---------------------------------------------------------------------------

export async function markThreadRead(requestId: string): Promise<void> {
  if (!requestId) return;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase
    .from("request_reads")
    .upsert(
      { request_id: requestId, user_id: user.id, last_read_at: new Date().toISOString() },
      { onConflict: "request_id,user_id" },
    );
}

// ---------------------------------------------------------------------------
// Notifications: mark read
// ---------------------------------------------------------------------------

export async function markNotificationRead(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const supabase = await createClient();
  await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id);
  revalidatePath("/notifications");
}

export async function markAllNotificationsRead(): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("recipient_id", user.id)
    .is("read_at", null);
  revalidatePath("/notifications");
}
