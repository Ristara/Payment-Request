"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendPushToUsers } from "@/lib/push";

export type RequestState = { error?: string; info?: string } | undefined;

// ---------------------------------------------------------------------------
// createRequest — used by /requests/new
// ---------------------------------------------------------------------------

export async function createRequest(
  _prev: RequestState,
  formData: FormData,
): Promise<RequestState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const vendor_id = String(formData.get("vendor_id") ?? "");
  const outlet_ids = formData.getAll("outlet_ids").map((s) => String(s)).filter(Boolean);
  const po_number = String(formData.get("po_number") ?? "").trim() || null;
  const po_not_applicable_reason =
    String(formData.get("po_not_applicable_reason") ?? "").trim() || null;
  const invoice_reference = String(formData.get("invoice_reference") ?? "").trim() || null;
  const total_bill_value = Number(formData.get("total_bill_value") ?? 0);
  const payment_amount = Number(formData.get("payment_amount") ?? 0);
  const payment_percentage_raw = formData.get("payment_percentage");
  const payment_percentage = payment_percentage_raw ? Number(payment_percentage_raw) : null;
  const previous_payments = Number(formData.get("previous_payments") ?? 0);
  const payment_due_date = String(formData.get("payment_due_date") ?? "");
  const date_of_work_completion =
    String(formData.get("date_of_work_completion") ?? "") || null;
  const tentative_invoice_date =
    String(formData.get("tentative_invoice_date") ?? "") || null;
  const coa_account_id = String(formData.get("coa_account_id") ?? "");
  const supply_composition = String(formData.get("supply_composition") ?? "") as
    | "material"
    | "service"
    | "mixed";
  const material_percentage = formData.get("material_percentage")
    ? Number(formData.get("material_percentage"))
    : null;
  const service_percentage = formData.get("service_percentage")
    ? Number(formData.get("service_percentage"))
    : null;
  const purpose = String(formData.get("purpose") ?? "").trim();
  const cost_centre = String(formData.get("cost_centre") ?? "").trim() || null;
  const files = formData.getAll("attachments").filter((f): f is File => f instanceof File && f.size > 0);

  // Validation
  if (!vendor_id) return { error: "Pick a vendor." };
  if (outlet_ids.length === 0) return { error: "Pick at least one outlet." };
  if (!total_bill_value || total_bill_value <= 0) return { error: "Total bill value must be positive." };
  if (!payment_amount || payment_amount <= 0) return { error: "Payment amount must be positive." };
  if (payment_amount > total_bill_value - previous_payments) {
    return { error: "Payment amount + previous payments can't exceed total bill." };
  }
  if (!payment_due_date) return { error: "Payment due date is required." };
  if (!coa_account_id) return { error: "Pick a subcategory (Chart of Accounts)." };
  if (!supply_composition) return { error: "Pick supply composition." };
  if (supply_composition === "mixed") {
    if (material_percentage == null || service_percentage == null) {
      return { error: "Material % and Service % are required for Mixed." };
    }
    if (Math.abs(material_percentage + service_percentage - 100) > 0.01) {
      return { error: "Material % + Service % must equal 100." };
    }
  }
  if (!purpose) return { error: "Purpose / description is required." };

  // Verify the selected COA account exists.
  const { data: coaRow } = await supabase
    .from("coa_accounts")
    .select("id")
    .eq("id", coa_account_id)
    .single();
  if (!coaRow) return { error: "Selected COA account not found." };

  // Verify vendor is approved
  const { data: vendor } = await supabase
    .from("vendors")
    .select("status")
    .eq("id", vendor_id)
    .single();
  if (!vendor) return { error: "Vendor not found." };
  if (vendor.status !== "approved") {
    return { error: "Vendor is still being verified by Accounts. You can still save + submit — but payment will pause until vendor is approved." };
  }

  // Generate request number: PR-YYYY-NNNNN
  const admin = createAdminClient();
  const { data: seq } = await admin.rpc("nextval", { sequence_name: "request_number_seq" }).select();
  // Fallback if RPC doesn't exist — use raw sql via admin.
  let requestNumber = "";
  if (seq && typeof seq === "number") {
    requestNumber = `PR-${new Date().getFullYear()}-${String(seq).padStart(5, "0")}`;
  } else {
    const { data: n } = await admin
      .from("payment_requests")
      .select("id", { count: "exact", head: true });
    requestNumber = `PR-${new Date().getFullYear()}-${String((n as unknown as { count?: number })?.count ?? Math.floor(Math.random() * 99999)).padStart(5, "0")}`;
  }

  const { data: inserted, error } = await supabase
    .from("payment_requests")
    .insert({
      request_number: requestNumber,
      status: "pending_approval",
      submitter_id: user.id,
      vendor_id,
      po_number,
      po_not_applicable_reason,
      invoice_reference,
      total_bill_value,
      payment_percentage,
      payment_amount,
      previous_payments,
      payment_due_date,
      date_of_work_completion,
      tentative_invoice_date,
      coa_account_id,
      supply_composition,
      material_percentage,
      service_percentage,
      purpose,
      cost_centre,
      submitted_at: new Date().toISOString(),
    })
    .select("id, request_number")
    .single();

  if (error || !inserted) return { error: error?.message ?? "Failed to create request." };

  const requestId = inserted.id as string;

  // Insert outlets
  await supabase.from("request_outlets").insert(
    outlet_ids.map((outlet_id) => ({ request_id: requestId, outlet_id })),
  );

  // Status history entry
  await admin.from("status_history").insert({
    request_id: requestId,
    actor_id: user.id,
    from_status: null,
    to_status: "pending_approval",
    comment: "Created and submitted",
  });

  // Upload attachments
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

  // Notify all approvers (in-app + push)
  const { data: approvers } = await admin
    .from("user_roles")
    .select("user_id")
    .eq("role", "approver");
  const approverIds = ((approvers ?? []) as { user_id: string }[]).map((r) => r.user_id).filter((id) => id !== user.id);
  if (approverIds.length > 0) {
    await admin.from("notifications").insert(
      approverIds.map((recipient_id) => ({
        recipient_id,
        actor_id: user.id,
        kind: "request_submitted",
        request_id: requestId,
        body: `${requestNumber} · ${formatShortAmount(payment_amount)}`,
      })),
    );
    const { data: submitter } = await admin.from("profiles").select("full_name").eq("id", user.id).single();
    await sendPushToUsers(approverIds, {
      title: `New request from ${submitter?.full_name ?? "someone"}`,
      body: `${requestNumber} · ${formatShortAmount(payment_amount)}`,
      url: `/requests/${requestId}`,
      tag: `request-${requestId}`,
    });
  }

  revalidatePath("/requests");
  revalidatePath("/approvals");
  redirect(`/requests/${requestId}`);
}

function formatShortAmount(n: number): string {
  return "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

// ---------------------------------------------------------------------------
// Approve / Reject / Return / Ask Clarification
// ---------------------------------------------------------------------------

async function currentUserOrThrow() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  return { supabase, user };
}

async function transition(
  requestId: string,
  from: string | null,
  to: string,
  comment: string | null,
  extra: Record<string, unknown> = {},
) {
  const admin = createAdminClient();
  const { supabase, user } = await currentUserOrThrow();
  const { error } = await supabase
    .from("payment_requests")
    .update({ status: to, ...extra })
    .eq("id", requestId);
  if (error) throw error;
  await admin.from("status_history").insert({
    request_id: requestId,
    actor_id: user.id,
    from_status: from,
    to_status: to,
    comment,
  });

  // Notify the submitter on status changes that matter to them.
  const notifiableKinds: Record<string, string> = {
    approved: "request_approved",
    rejected: "request_rejected",
    returned_for_correction: "request_returned",
    payment_processed: "payment_processed",
    invoice_pending: "invoice_reminder",
    closed: "request_closed",
  };
  if (notifiableKinds[to]) {
    const { data: req } = await admin
      .from("payment_requests")
      .select("submitter_id, request_number")
      .eq("id", requestId)
      .single();
    if (req && req.submitter_id !== user.id) {
      const { data: actor } = await admin.from("profiles").select("full_name").eq("id", user.id).single();
      await admin.from("notifications").insert({
        recipient_id: req.submitter_id,
        actor_id: user.id,
        kind: notifiableKinds[to],
        request_id: requestId,
        body: `${req.request_number} → ${to.replace(/_/g, " ")}`,
      });
      await sendPushToUsers([req.submitter_id], {
        title: `${actor?.full_name ?? "Someone"} ${to.replace(/_/g, " ")} your request`,
        body: `${req.request_number}${comment ? " · " + comment.slice(0, 100) : ""}`,
        url: `/requests/${requestId}`,
        tag: `request-${requestId}`,
      });
    }
    // Notify Accounts when a request is approved
    if (to === "approved") {
      const { data: acc } = await admin.from("user_roles").select("user_id").eq("role", "accounts");
      const accIds = ((acc ?? []) as { user_id: string }[]).map((r) => r.user_id).filter((id) => id !== user.id);
      if (accIds.length > 0) {
        const { data: r } = await admin.from("payment_requests").select("request_number").eq("id", requestId).single();
        await admin.from("notifications").insert(accIds.map((recipient_id) => ({
          recipient_id,
          actor_id: user.id,
          kind: "ready_for_payment",
          request_id: requestId,
          body: `${r?.request_number} ready to process`,
        })));
        await sendPushToUsers(accIds, {
          title: "Request ready for payment",
          body: `${r?.request_number} approved and awaiting bank upload`,
          url: `/requests/${requestId}`,
          tag: `request-${requestId}`,
        });
      }
    }
  }
}

export async function approveRequest(
  _prev: RequestState,
  formData: FormData,
): Promise<RequestState> {
  const requestId = String(formData.get("request_id") ?? "");
  if (!requestId) return { error: "Missing request." };
  try {
    const { user } = await currentUserOrThrow();
    await transition(requestId, "pending_approval", "approved", null, {
      approver_id: user.id,
      approved_at: new Date().toISOString(),
    });
    revalidatePath(`/requests/${requestId}`);
    revalidatePath("/approvals");
    return { info: "Approved." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function rejectRequest(
  _prev: RequestState,
  formData: FormData,
): Promise<RequestState> {
  const requestId = String(formData.get("request_id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!requestId) return { error: "Missing request." };
  if (!reason) return { error: "Reason is required." };
  try {
    await transition(requestId, "pending_approval", "rejected", reason, {
      rejection_reason: reason,
    });
    revalidatePath(`/requests/${requestId}`);
    revalidatePath("/approvals");
    return { info: "Rejected." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function returnRequest(
  _prev: RequestState,
  formData: FormData,
): Promise<RequestState> {
  const requestId = String(formData.get("request_id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!requestId) return { error: "Missing request." };
  if (!reason) return { error: "Reason is required." };
  try {
    await transition(requestId, "pending_approval", "returned_for_correction", reason, {
      return_reason: reason,
    });
    revalidatePath(`/requests/${requestId}`);
    revalidatePath("/approvals");
    return { info: "Returned for correction." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function cancelRequest(
  _prev: RequestState,
  formData: FormData,
): Promise<RequestState> {
  const requestId = String(formData.get("request_id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!requestId || !reason) return { error: "Reason is required." };
  try {
    await transition(requestId, null, "cancelled", reason, {
      cancelled_at: new Date().toISOString(),
      cancellation_reason: reason,
    });
    revalidatePath(`/requests/${requestId}`);
    return { info: "Cancelled." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

// ---------------------------------------------------------------------------
// Change COA on a request (Approver or Accounts)
// ---------------------------------------------------------------------------

export async function overrideCoa(
  _prev: RequestState,
  formData: FormData,
): Promise<RequestState> {
  const requestId = String(formData.get("request_id") ?? "");
  const newCoaId = String(formData.get("new_coa_account_id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!requestId || !newCoaId || !reason) return { error: "New COA + reason required." };

  const supabase = await createClient();
  const admin = createAdminClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { data: req } = await supabase
    .from("payment_requests")
    .select("coa_account_id")
    .eq("id", requestId)
    .single();
  if (!req) return { error: "Request not found." };

  const old_coa_account_id = req.coa_account_id as string;
  if (old_coa_account_id === newCoaId) return { info: "COA unchanged." };

  await supabase.from("payment_requests").update({ coa_account_id: newCoaId }).eq("id", requestId);
  await admin.from("coa_override_log").insert({
    request_id: requestId,
    actor_id: user.id,
    old_coa_account_id,
    new_coa_account_id: newCoaId,
    reason,
  });

  revalidatePath(`/requests/${requestId}`);
  return { info: "COA updated." };
}

// ---------------------------------------------------------------------------
// Accounts: bank upload / mark paid / mark invoice / close
// ---------------------------------------------------------------------------

export async function markBankUploaded(
  _prev: RequestState,
  formData: FormData,
): Promise<RequestState> {
  const requestId = String(formData.get("request_id") ?? "");
  const bank_upload_date = String(formData.get("bank_upload_date") ?? "");
  const bank_batch_ref = String(formData.get("bank_batch_ref") ?? "").trim() || null;
  if (!requestId || !bank_upload_date) return { error: "Bank upload date is required." };

  const supabase = await createClient();
  await supabase
    .from("payment_records")
    .upsert({ request_id: requestId, bank_upload_date, bank_batch_ref });
  try {
    await transition(requestId, "approved", "uploaded_in_bank", "Marked uploaded in bank");
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath(`/requests/${requestId}`);
  revalidatePath("/accounts");
  return { info: "Marked as uploaded in bank." };
}

export async function markPaid(
  _prev: RequestState,
  formData: FormData,
): Promise<RequestState> {
  const requestId = String(formData.get("request_id") ?? "");
  const payment_date = String(formData.get("payment_date") ?? "");
  const paid_amount = Number(formData.get("paid_amount") ?? 0);
  const utr_reference = String(formData.get("utr_reference") ?? "").trim();
  const paying_bank_account = String(formData.get("paying_bank_account") ?? "").trim() || null;
  const proof = formData.get("proof");
  if (!requestId || !payment_date || !paid_amount || !utr_reference) {
    return { error: "Payment date, amount, and UTR are all required." };
  }

  const supabase = await createClient();
  const admin = createAdminClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  await supabase
    .from("payment_records")
    .upsert({
      request_id: requestId,
      payment_date,
      paid_amount,
      utr_reference,
      paying_bank_account,
      recorded_by: user.id,
    });

  // Upload payment proof (if any)
  if (proof instanceof File && proof.size > 0) {
    const safe = proof.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${requestId}/payment/${Date.now()}-${safe}`;
    const buf = await proof.arrayBuffer();
    const { error: uploadErr } = await admin.storage
      .from("request-attachments")
      .upload(path, buf, { contentType: proof.type || "application/octet-stream" });
    if (!uploadErr) {
      await admin.from("attachments").insert({
        request_id: requestId,
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
    // Move to invoice_pending unless an invoice has already been attached.
    const { data: invExists } = await admin
      .from("attachments")
      .select("id", { count: "exact", head: true })
      .eq("request_id", requestId)
      .eq("stage", "invoice");
    const nextStatus =
      ((invExists as unknown as { count?: number })?.count ?? 0) > 0
        ? "payment_processed"
        : "invoice_pending";
    await transition(requestId, "uploaded_in_bank", nextStatus, "Payment processed");
  } catch (e) {
    return { error: (e as Error).message };
  }

  revalidatePath(`/requests/${requestId}`);
  revalidatePath("/accounts");
  return { info: "Payment recorded." };
}

export async function uploadInvoice(
  _prev: RequestState,
  formData: FormData,
): Promise<RequestState> {
  const requestId = String(formData.get("request_id") ?? "");
  const invoice = formData.get("invoice");
  if (!requestId || !(invoice instanceof File) || invoice.size === 0) {
    return { error: "Pick an invoice file." };
  }

  const supabase = await createClient();
  const admin = createAdminClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const safe = invoice.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${requestId}/invoice/${Date.now()}-${safe}`;
  const buf = await invoice.arrayBuffer();
  const { error: uploadErr } = await admin.storage
    .from("request-attachments")
    .upload(path, buf, { contentType: invoice.type || "application/octet-stream" });
  if (uploadErr) return { error: uploadErr.message };

  await admin.from("attachments").insert({
    request_id: requestId,
    stage: "invoice",
    storage_path: path,
    file_name: invoice.name,
    file_size_bytes: invoice.size,
    mime_type: invoice.type || null,
    uploaded_by: user.id,
  });

  // If currently invoice_pending, keep status as invoice_pending; closure is a
  // separate action by Accounts.
  revalidatePath(`/requests/${requestId}`);
  return { info: "Invoice uploaded." };
}

export async function closeRequest(
  _prev: RequestState,
  formData: FormData,
): Promise<RequestState> {
  const requestId = String(formData.get("request_id") ?? "");
  if (!requestId) return { error: "Missing request." };
  try {
    await transition(requestId, null, "closed", "Verified and closed");
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath(`/requests/${requestId}`);
  revalidatePath("/accounts");
  return { info: "Closed." };
}

// ---------------------------------------------------------------------------
// Add a comment / reply
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
    await admin
      .from("comment_mentions")
      .insert(mentions.map((mentioned_user_id) => ({ comment_id: commentId, mentioned_user_id })));

    // Fire in-app notifications
    await admin.from("notifications").insert(
      mentions.map((recipient_id) => ({
        recipient_id,
        actor_id: user.id,
        kind: "mentioned",
        request_id: requestId,
        body: body.slice(0, 140) || "(attachment)",
      })),
    );

    // Fire push notifications (best-effort)
    const { data: actor } = await admin.from("profiles").select("full_name").eq("id", user.id).single();
    await sendPushToUsers(mentions, {
      title: `${actor?.full_name ?? "Someone"} mentioned you`,
      body: body.slice(0, 140) || "(attachment)",
      url: `/requests/${requestId}`,
      tag: `request-${requestId}`,
    });

    // If the mention comes with a question, mark the request as clarification_required.
    if (isQuestion) {
      const { data: current } = await supabase
        .from("payment_requests")
        .select("status")
        .eq("id", requestId)
        .single();
      if (current && (current.status === "pending_approval" || current.status === "clarification_required")) {
        try {
          await transition(requestId, current.status as string, "clarification_required", body.slice(0, 200));
        } catch { /* best-effort */ }
      }
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

// ---------------------------------------------------------------------------
// Resolve / reopen a question
// ---------------------------------------------------------------------------

export async function setQuestionState(formData: FormData): Promise<void> {
  const commentId = String(formData.get("comment_id") ?? "");
  const state = String(formData.get("state") ?? "");
  const requestId = String(formData.get("request_id") ?? "");
  if (!commentId || !["open", "answered", "resolved"].includes(state)) return;
  const supabase = await createClient();
  await supabase.from("comments").update({ question_state: state }).eq("id", commentId);

  // If all questions on a clarification_required request are resolved/answered,
  // move back to pending_approval.
  if (requestId) {
    const { data: req } = await supabase
      .from("payment_requests")
      .select("status")
      .eq("id", requestId)
      .single();
    if (req?.status === "clarification_required") {
      const { data: open } = await supabase
        .from("comments")
        .select("id", { count: "exact", head: true })
        .eq("request_id", requestId)
        .eq("is_question", true)
        .eq("question_state", "open");
      if (((open as unknown as { count?: number })?.count ?? 0) === 0) {
        try {
          await transition(requestId, "clarification_required", "pending_approval", "Clarifications resolved");
        } catch { /* best-effort */ }
      }
    }
  }
  revalidatePath(`/requests/${requestId}`);
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
