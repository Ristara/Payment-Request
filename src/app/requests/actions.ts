"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendPushToUsers } from "@/lib/push";
import { computeRollupIds } from "@/lib/coa";
import { invalidateMasters } from "@/lib/cache";
import { oversizedFile } from "@/lib/uploads";
import { shortRequestNumber } from "@/lib/types";
import { getDeletionImpact, purgeRequest } from "@/lib/purge-request";
import { getRaiseAccess, raiseDenied, type ExpenseType } from "@/lib/access";

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

/**
 * Role gate for actions that move an installment. The installments UPDATE
 * policy also admits the thread's own submitter, so without this a submitter
 * could POST straight at approve/reject/close and clear their own payment.
 */
/**
 * Raising a payment request needs the requester role.
 *
 * Being signed in used to be the entire test, so a user whose roles had all
 * been removed could still submit. RLS refuses these inserts too (migration
 * 024) — this is the half that produces a sentence instead of a raw
 * database error. Returns the message to show, or null if allowed.
 */
async function cannotRaise(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<string | null> {
  const [{ data }, { data: profile }] = await Promise.all([
    supabase.from("user_roles").select("role").eq("user_id", userId),
    supabase.from("profiles").select("is_active").eq("id", userId).maybeSingle(),
  ]);
  if ((profile as { is_active?: boolean } | null)?.is_active === false) {
    return "Your account is inactive. Contact an admin.";
  }
  const roles = new Set(((data ?? []) as { role: string }[]).map((r) => r.role));
  if (roles.has("requester") || roles.has("admin")) return null;
  return "You don't have permission to raise payment requests. Ask an admin to give you the Requester role.";
}

/**
 * Has money actually been paid against this installment?
 *
 * Deliberately not "does a payment_records row exist": a row is also created
 * when a batch is uploaded to the bank, and it survives being pulled back out
 * so the batch reference isn't lost. Only an amount or a UTR means the money
 * left.
 */
async function hasSettledPayment(
  admin: ReturnType<typeof createAdminClient>,
  installmentId: string,
): Promise<boolean> {
  const { data } = await admin
    .from("payment_records")
    .select("paid_amount, utr_reference")
    .eq("installment_id", installmentId)
    .maybeSingle();
  const rec = data as { paid_amount: number | null; utr_reference: string | null } | null;
  return !!rec && (rec.paid_amount != null || !!rec.utr_reference);
}

/**
 * Is this person on the thread — the one who raised it, or someone CC'd?
 *
 * CC is how a request gets picked up by a second person, so a watcher works
 * it the same way the submitter would: raising the next installment,
 * extending the PO, resubmitting a correction. It does NOT confer a role —
 * raising still needs `requester`.
 */
async function isThreadParticipant(
  admin: ReturnType<typeof createAdminClient>,
  requestId: string,
  userId: string,
  submitterId: string,
): Promise<boolean> {
  if (submitterId === userId) return true;
  const { data } = await admin
    .from("request_watchers")
    .select("user_id")
    .eq("request_id", requestId)
    .eq("user_id", userId)
    .maybeSingle();
  return !!data;
}

async function requireRole(...allowed: string[]) {
  const { supabase, user } = await currentUserOrThrow();
  const { data } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
  const roles = new Set(((data ?? []) as { role: string }[]).map((r) => r.role));
  if (!allowed.some((r) => roles.has(r))) {
    throw new Error("You don't have permission to do that.");
  }
  return { supabase, user, roles };
}

async function currentUserOrThrow() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  // Pages check this too, but a server action can be invoked directly, and a
  // deactivated account keeps a valid session until it expires.
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_active")
    .eq("id", user.id)
    .maybeSingle();
  if ((profile as { is_active?: boolean } | null)?.is_active === false) {
    throw new Error("Your account is inactive. Contact an admin.");
  }
  return { supabase, user };
}


// ---------------------------------------------------------------------------
// Line-item account resolution, shared by createThread and the PO editor.
//
// Mutates each line's coa_account_id in place: a line with no subcategory
// picked is charged to its category's self-named anchor row. Returns an error
// message, or null when every line is valid.
// ---------------------------------------------------------------------------

type LineIn = { coa_account_id: string; coa?: string; category?: string; quantity: number; rate: number };

async function resolveLineAccounts(
  supabase: Awaited<ReturnType<typeof createClient>>,
  lines: LineIn[],
): Promise<string | null> {
  // ------ Resolve category-level lines (no subcategory picked) ------
  // Such a line charges the category's SELF-NAMED anchor row (subcategory =
  // category = the category's own name, so reports bucket it under the right
  // category). Find-or-create keeps this working for categories added or
  // renamed after the backfill migration.
  const adminDb = createAdminClient();
  const anchorIdByPair = new Map<string, string>();
  const categoryPairs = Array.from(
    new Set(
      lines
        .filter((l) => !l.coa_account_id)
        .map((l) => JSON.stringify([String(l.coa ?? "").trim(), String(l.category ?? "").trim()])),
    ),
  ).map((s) => JSON.parse(s) as [string, string]);
  for (const [coaHead, category] of categoryPairs) {
    // The category must genuinely exist in the active chart of accounts.
    const { data: catRow, error: catErr } = await supabase
      .from("coa_accounts")
      .select("id")
      .eq("coa", coaHead)
      .eq("category", category)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();
    if (catErr) return "Couldn't verify the category — please try again.";
    if (!catRow) return `Category "${category}" doesn't exist any more — pick another.`;

    // Fetch anchors ACTIVE OR NOT: a deactivated anchor means an admin
    // deliberately blocked whole-category charging — respect it, don't
    // resurrect it.
    const { data: anchorRows, error: anchorErr } = await supabase
      .from("coa_accounts")
      .select("id, is_active")
      .eq("coa", coaHead)
      .eq("category", category)
      .eq("subcategory", category)
      .order("code");
    if (anchorErr) return "Couldn't verify the category — please try again.";
    const activeAnchor = (anchorRows ?? []).find((r) => r.is_active);
    if (activeAnchor) {
      anchorIdByPair.set(JSON.stringify([coaHead, category]), activeAnchor.id as string);
    } else if ((anchorRows ?? []).length > 0) {
      return `"${category}" can't be charged as a whole category — pick a specific subcategory.`;
    } else {
      // Category created after the backfill migration — mint its anchor.
      // On a concurrent-insert race, fall back to re-reading the winner.
      const { data: created, error: createErr } = await adminDb
        .from("coa_accounts")
        .insert({ subcategory: category, category, coa: coaHead })
        .select("id")
        .single();
      let anchorId = created?.id as string | undefined;
      if (createErr || !anchorId) {
        const { data: retry } = await supabase
          .from("coa_accounts")
          .select("id")
          .eq("coa", coaHead)
          .eq("category", category)
          .eq("subcategory", category)
          .eq("is_active", true)
          .order("code")
          .limit(1)
          .maybeSingle();
        anchorId = retry?.id as string | undefined;
      }
      if (!anchorId) return `Couldn't charge to category "${category}" — try picking a subcategory.`;
      invalidateMasters();
      anchorIdByPair.set(JSON.stringify([coaHead, category]), anchorId);
    }
  }
  for (const l of lines) {
    if (!l.coa_account_id) {
      l.coa_account_id =
        anchorIdByPair.get(
          JSON.stringify([String(l.coa ?? "").trim(), String(l.category ?? "").trim()]),
        ) ?? "";
    }
  }

  // ------ CoA validation (existence + active + rollup guard) ------
  const uniqueCoaIds = Array.from(new Set(lines.map((l) => l.coa_account_id)));
  const { data: pickedRows } = await supabase
    .from("coa_accounts")
    .select("id, subcategory, category, coa")
    .in("id", uniqueCoaIds)
    .eq("is_active", true);
  if ((pickedRows?.length ?? 0) !== uniqueCoaIds.length) {
    return "One or more selected accounts don't exist or are inactive.";
  }
  // A picked subcategory must sit under BOTH the COA head and the category
  // the form showed — guards against stale client state and crafted payloads.
  const rowById = new Map((pickedRows ?? []).map((r) => [r.id as string, r]));
  const mismatched = lines.findIndex((l) => {
    const coaHead = String(l.coa ?? "").trim();
    const category = String(l.category ?? "").trim();
    if (!coaHead || !category) return false;
    const row = rowById.get(l.coa_account_id);
    return !!row && (row.coa !== coaHead || row.category !== category);
  });
  if (mismatched !== -1) {
    return `Line ${mismatched + 1}: that subcategory doesn't belong to the picked COA head and category — reselect it.`;
  }
  // Rollup knit rows are still not chargeable directly — category-level lines
  // use the self-named anchors, which are not rollups.
  const coaHeadsInPlay = Array.from(new Set((pickedRows ?? []).map((r) => r.coa as string)));
  const { data: siblingRows } = await supabase
    .from("coa_accounts")
    .select("id, subcategory, category, coa")
    .in("coa", coaHeadsInPlay)
    .eq("is_active", true);
  const rollups = computeRollupIds((siblingRows ?? []) as { id: string; subcategory: string; category: string; coa: string }[]);
  const badRollup = (pickedRows ?? []).find((r) => rollups.has(r.id as string));
  if (badRollup) {
    return `"${badRollup.subcategory}" is a group / rollup, not a spendable subcategory. Pick one of its child subcategories instead.`;
  }

  return null;
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
  const denied = await cannotRaise(supabase, user.id);
  if (denied) return { error: denied };

  const vendor_id = String(formData.get("vendor_id") ?? "");
  const title = String(formData.get("title") ?? "").trim().slice(0, 200);
  const outlet_ids = formData.getAll("outlet_ids").map((s) => String(s)).filter(Boolean);
  const document_type = String(formData.get("document_type") ?? "") as
    | "po" | "invoice" | "no_invoice" | "invoice_pending" | "";
  const document_reference = String(formData.get("document_reference") ?? "").trim() || null;
  const payment_kind = String(formData.get("payment_kind") ?? "") as "regular" | "milestone" | "";
  const expenseRaw = String(formData.get("expense_type") ?? "capex");
  const expense_type: ExpenseType = expenseRaw === "opex" ? "opex" : "capex";
  const installment_amount = Number(formData.get("installment_amount") ?? 0);
  const payment_due_date = String(formData.get("payment_due_date") ?? "");
  const date_of_work_completion = String(formData.get("date_of_work_completion") ?? "") || null;
  const tentative_invoice_date = String(formData.get("tentative_invoice_date") ?? "") || null;

  const linesRaw = String(formData.get("line_items") ?? "[]");
  // coa_account_id empty = category-level line: the server resolves (coa,
  // category) to the category's self-named anchor row below.
  let lines: LineIn[] = [];
  try {
    lines = JSON.parse(linesRaw) as LineIn[];
  } catch {
    return { error: "Invalid line items payload." };
  }
  const purpose = String(formData.get("purpose") ?? "").trim();
  const files = formData.getAll("attachments").filter((f): f is File => f instanceof File && f.size > 0);
  const oversized = oversizedFile(files);
  if (oversized) return { error: oversized };
  let ccUserIds: string[] = [];
  try {
    ccUserIds = JSON.parse(String(formData.get("cc_user_ids") ?? "[]")) as string[];
  } catch { /* optional field */ }
  ccUserIds = Array.from(new Set(ccUserIds.filter((s) => typeof s === "string" && s && s !== user.id)));

  // ------ Validation ------
  if (!title) return { error: "Give the request a short title." };
  if (!vendor_id) return { error: "Pick a vendor." };
  if (outlet_ids.length === 0) return { error: "Pick at least one outlet." };
  if (!installment_amount || installment_amount <= 0) return { error: "First installment amount must be positive." };
  if (!payment_due_date) return { error: "Payment due date is required." };
  if (!payment_kind) return { error: "Pick a payment kind — Regular or Milestone." };
  if (!document_type) return { error: "Pick a document type." };
  if ((document_type === "po" || document_type === "invoice") && !document_reference) {
    return { error: `Enter the ${document_type === "po" ? "PO" : "invoice"} number.` };
  }
  const tentativeRequired = document_type === "po" || document_type === "invoice_pending";
  if (tentativeRequired && !tentative_invoice_date) {
    return { error: "Tentative invoice date is required for PO / Invoice yet to receive." };
  }
  if (lines.length === 0) return { error: "Add at least one line item." };
  const badLine = lines.findIndex(
    (l) =>
      (!l.coa_account_id && !(String(l.coa ?? "").trim() && String(l.category ?? "").trim())) ||
      !(l.quantity > 0) ||
      !(l.rate >= 0),
  );
  if (badLine !== -1) return { error: `Line ${badLine + 1}: category + quantity + rate all required.` };

  const poValue = Math.round(lines.reduce((s, l) => s + l.quantity * l.rate, 0) * 100) / 100;
  if (poValue <= 0) return { error: "PO value must be positive." };
  if (installment_amount - poValue > 0.005) {
    return {
      error: `First installment ${formatExactAmount(installment_amount)} can't exceed PO value ${formatExactAmount(poValue)}.`,
    };
  }
  if (!purpose) return { error: "Purpose / description is required." };
  // Picking "Invoice" asserts the invoice exists; the other document types
  // are exactly the cases where it doesn't yet. Checked here as well as in
  // the form, because the form can be bypassed.
  if (document_type === "invoice" && files.length === 0) {
    return { error: "Attach the invoice — it's required when the document type is Invoice." };
  }

  // ------ Resolve + validate line accounts ------
  const coaError = await resolveLineAccounts(supabase, lines);
  if (coaError) return { error: coaError };
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

  // ------ Branch + expense-type access ------
  // Checked here as well as in RLS: this is the message the submitter reads,
  // and the policy is the thing a crafted request runs into.
  {
    const { data: roleRows } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
    const isAdmin = ((roleRows ?? []) as { role: string }[]).some((r) => r.role === "admin");
    const access = await getRaiseAccess(user.id, isAdmin);
    const noAccess = raiseDenied(access, outlet_ids, expense_type);
    if (noAccess) return { error: noAccess };
  }

  // ------ Insert thread ------
  const { data: inserted, error } = await supabase
    .from("payment_requests")
    .insert({
      request_number: requestNumber,
      submitter_id: user.id,
      title,
      vendor_id,
      expense_type,
      document_type,
      document_reference:
        document_type === "po" || document_type === "invoice" ? document_reference : null,
      payment_kind,
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
      if (uploadErr) {
        console.error("attachment upload failed", { path, message: uploadErr.message });
        continue;
      }
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

  // ------ CC watchers: visibility + a heads-up notification ------
  if (ccUserIds.length > 0) {
    const { error: ccErr } = await admin.from("request_watchers").insert(
      ccUserIds.map((uid) => ({ request_id: requestId, user_id: uid, added_by: user.id })),
    );
    if (ccErr) console.error("[createThread] watchers insert failed:", ccErr);
    else {
      await admin.from("notifications").insert(
        ccUserIds.map((recipient_id) => ({
          recipient_id,
          actor_id: user.id,
          kind: "mentioned",
          request_id: requestId,
          body: `You were CC'd on ${shortRequestNumber(requestNumber)}`,
        })),
      );
      const { data: submitterName } = await admin.from("profiles").select("full_name").eq("id", user.id).single();
      await sendPushToUsers(ccUserIds, {
        title: `${submitterName?.full_name ?? "Someone"} CC'd you`,
        body: `${shortRequestNumber(requestNumber)} · ${formatShortAmount(installment_amount)}`,
        url: `/requests/${requestId}`,
        tag: `request-${requestId}`,
      });
    }
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
  const oversized = oversizedFile(files);
  if (oversized) return { error: oversized };

  if (!requestId) return { error: "Missing thread." };
  if (!requestedAmount || requestedAmount <= 0) return { error: "Installment amount must be positive." };
  if (!paymentDueDate) return { error: "Payment due date is required." };

  const supabase = await createClient();
  const admin = createAdminClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };
  const denied = await cannotRaise(supabase, user.id);
  if (denied) return { error: denied };

  // Thread + line items + prior installments (for balance check)
  const [threadRes, linesRes, instRes] = await Promise.all([
    supabase.from("payment_requests").select("id, request_number, submitter_id, document_type").eq("id", requestId).single(),
    supabase.from("request_line_items").select("quantity, rate").eq("request_id", requestId),
    supabase.from("request_installments").select("requested_amount, status, tentative_invoice_date").eq("request_id", requestId),
  ]);
  if (!threadRes.data) return { error: "Thread not found." };

  const poValue = Math.round((linesRes.data ?? []).reduce((s, l) => s + Number(l.quantity) * Number(l.rate), 0) * 100) / 100;
  const nonCancelledInstallments = (instRes.data ?? []).filter(
    (i) => !["cancelled", "rejected", "draft"].includes(i.status as string),
  );
  const alreadyRequested = nonCancelledInstallments.reduce((s, i) => s + Number(i.requested_amount), 0);
  const remaining = Math.round((poValue - alreadyRequested) * 100) / 100;

  if (requestedAmount - remaining > 0.005) {
    return {
      error: `Only ${formatExactAmount(remaining)} left on this PO (${formatExactAmount(poValue)} total, ${formatExactAmount(alreadyRequested)} already requested). Raise a new thread if scope has grown.`,
    };
  }

  const nextNumber = (instRes.data?.length ?? 0) + 1;
  // An explicit date on this installment wins; otherwise carry the earlier
  // one so a PO thread keeps its invoice expectation.
  const tentativeOverride = String(formData.get("tentative_invoice_date") ?? "").trim() || null;
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
      tentative_invoice_date: tentativeOverride ?? firstTentative,
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
      if (uploadErr) {
        console.error("attachment upload failed", { path, message: uploadErr.message });
        continue;
      }
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
    // pending_approval is also reachable backwards: a submitter re-submits a
    // recalled draft, or an approver pulls an approval back before Accounts
    // has uploaded it to the bank.
    pending_approval: ["clarification_required", "returned_for_correction", "rejected", "draft", "approved"],
    // Recalled by the submitter while it is still awaiting a decision.
    draft: ["pending_approval", "clarification_required"],
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
        body: `${shortRequestNumber(thread.request_number as string)} · installment #${inst.installment_number} → ${to.replace(/_/g, " ")}${
          comment ? ` · ${comment}` : ""
        }`,
      });
      await sendPushToUsers([thread.submitter_id], {
        title: `${actor?.full_name ?? "Someone"} ${to.replace(/_/g, " ")} installment #${inst.installment_number}`,
        body: `${shortRequestNumber(thread.request_number as string)}${comment ? " · " + comment.slice(0, 100) : ""}`,
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
          body: `${shortRequestNumber(t?.request_number as string)} · installment #${inst.installment_number} ready`,
        })));
        await sendPushToUsers(accIds, {
          title: "Installment ready for payment",
          body: `${shortRequestNumber(t?.request_number as string)} · installment #${inst.installment_number}`,
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
      body: `${shortRequestNumber(args.requestNumber)} · installment #${args.installmentNumber} · ${formatShortAmount(args.installmentAmount)}`,
    })),
  );
  const { data: submitter } = await admin.from("profiles").select("full_name").eq("id", args.actorId).single();
  await sendPushToUsers(approverIds, {
    title: `Installment #${args.installmentNumber} from ${submitter?.full_name ?? "someone"}`,
    body: `${shortRequestNumber(args.requestNumber)} · ${formatShortAmount(args.installmentAmount)}`,
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
    const { user } = await requireRole("approver", "admin");
    // An approver who raised the request themselves must not sign it off.
    // Holding both roles is normal here; approving your own spend is not.
    const admin0 = createAdminClient();
    const { data: own } = await admin0
      .from("request_installments")
      .select("request:payment_requests!inner(submitter_id)")
      .eq("id", installmentId)
      .maybeSingle();
    const ownReq = (own as { request: { submitter_id: string } | { submitter_id: string }[] } | null)?.request;
    const submitterId = Array.isArray(ownReq) ? ownReq[0]?.submitter_id : ownReq?.submitter_id;
    if (submitterId && submitterId === user.id) {
      return { error: "You raised this request — someone else has to approve it." };
    }

    // An approver may sign off a different figure — trimming to what was
    // actually delivered, say — rather than bouncing the whole request back.
    // Blank means "approve what was asked for".
    const revisedRaw = String(formData.get("revised_amount") ?? "").trim();
    let amountChange: { from: number; to: number } | null = null;
    const extra: Record<string, unknown> = {
      approver_id: user.id,
      approved_at: new Date().toISOString(),
    };

    if (revisedRaw !== "") {
      const revised = Number(revisedRaw);
      if (!Number.isFinite(revised) || revised <= 0) {
        return { error: "Enter a valid amount to approve." };
      }
      const { data: current } = await admin0
        .from("request_installments")
        .select("request_id, requested_amount")
        .eq("id", installmentId)
        .single();
      const was = Number((current as { requested_amount: number }).requested_amount);

      if (Math.abs(revised - was) > 0.005) {
        // Same balance guard the other amount-changing paths use: the PO
        // value minus every other live installment.
        const requestId = (current as { request_id: string }).request_id;
        const [linesRes, instRes] = await Promise.all([
          admin0.from("request_line_items").select("quantity, rate").eq("request_id", requestId),
          admin0.from("request_installments").select("id, requested_amount, status").eq("request_id", requestId),
        ]);
        const poValue =
          Math.round(
            (linesRes.data ?? []).reduce((sum, l) => sum + Number(l.quantity) * Number(l.rate), 0) * 100,
          ) / 100;
        const othersRequested = (instRes.data ?? [])
          .filter((i) => i.id !== installmentId && !["cancelled", "rejected", "draft"].includes(i.status as string))
          .reduce((sum, i) => sum + Number(i.requested_amount), 0);
        const remaining = Math.round((poValue - othersRequested) * 100) / 100;
        if (revised - remaining > 0.005) {
          return {
            error: `Only ${formatExactAmount(remaining)} available on this PO (${formatExactAmount(poValue)} total, ${formatExactAmount(othersRequested)} on other installments).`,
          };
        }
        extra.requested_amount = revised;
        amountChange = { from: was, to: revised };
      }
    }

    const inst = await transitionInstallment(
      installmentId,
      "approved",
      // Goes into the history entry AND the submitter's notification, so a
      // changed amount can't be approved quietly.
      amountChange
        ? `Approved at ${formatExactAmount(amountChange.to)} — reduced from the ${formatExactAmount(amountChange.from)} requested`
        : null,
      extra,
    );
    revalidatePath(`/requests/${inst.request_id}`);
    revalidatePath("/approvals");
    return {
      info: amountChange
        ? `Approved at ${formatExactAmount(amountChange.to)} — the submitter has been told it changed.`
        : "Approved.",
    };
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
    await requireRole("approver", "admin");
    const inst = await transitionInstallment(installmentId, "rejected", reason, { rejection_reason: reason });
    revalidatePath(`/requests/${inst.request_id}`);
    revalidatePath("/approvals");
    return { info: "Rejected." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

// ---------------------------------------------------------------------------
// Edit & resubmit a rejected / returned installment (submitter)
// ---------------------------------------------------------------------------

export async function editAndResubmitInstallment(
  _prev: RequestState,
  formData: FormData,
): Promise<RequestState> {
  {
    const supabase0 = await createClient();
    const { data: { user: u0 } } = await supabase0.auth.getUser();
    if (!u0) return { error: "Not signed in." };
    const denied0 = await cannotRaise(supabase0, u0.id);
    if (denied0) return { error: denied0 };
  }
  const installmentId = String(formData.get("installment_id") ?? "");
  const requestedAmount = Number(formData.get("requested_amount") ?? 0);
  const paymentDueDate = String(formData.get("payment_due_date") ?? "");
  const dateOfWorkCompletion = String(formData.get("date_of_work_completion") ?? "") || null;
  const note = String(formData.get("purpose") ?? "").trim() || null;
  const tentativeInvoiceDate = String(formData.get("tentative_invoice_date") ?? "").trim() || null;
  const files = formData.getAll("attachments").filter((f): f is File => f instanceof File && f.size > 0);
  const oversized = oversizedFile(files);
  if (oversized) return { error: oversized };

  if (!installmentId) return { error: "Missing installment." };
  if (!requestedAmount || requestedAmount <= 0) return { error: "Amount must be positive." };
  if (!paymentDueDate) return { error: "Payment due date is required." };

  const supabase = await createClient();
  const admin = createAdminClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { data: inst } = await admin
    .from("request_installments")
    .select("id, request_id, installment_number, status, requested_amount")
    .eq("id", installmentId)
    .single();
  if (!inst) return { error: "Installment not found." };
  if (!["rejected", "returned_for_correction", "draft"].includes(inst.status as string)) {
    return { error: "Only a draft, rejected or returned installment can be edited and resubmitted." };
  }

  // Only the thread's submitter (or admin) may resubmit.
  const { data: thread } = await admin
    .from("payment_requests")
    .select("id, request_number, submitter_id")
    .eq("id", inst.request_id)
    .single();
  if (!thread) return { error: "Thread not found." };
  const { data: roleRows } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
  const roles = new Set(((roleRows ?? []) as { role: string }[]).map((r) => r.role));
  if (
    !(await isThreadParticipant(admin, thread.id as string, user.id, thread.submitter_id as string)) &&
    !roles.has("admin")
  ) {
    return { error: "Only the person who raised this, or someone CC'd on it, can edit and resubmit." };
  }

  // Balance guard: PO value minus every OTHER live installment.
  const [linesRes, instRes] = await Promise.all([
    admin.from("request_line_items").select("quantity, rate").eq("request_id", inst.request_id),
    admin.from("request_installments").select("id, requested_amount, status").eq("request_id", inst.request_id),
  ]);
  const poValue = Math.round((linesRes.data ?? []).reduce((s, l) => s + Number(l.quantity) * Number(l.rate), 0) * 100) / 100;
  const othersRequested = (instRes.data ?? [])
    .filter((i) => i.id !== installmentId && !["cancelled", "rejected", "draft"].includes(i.status as string))
    .reduce((s, i) => s + Number(i.requested_amount), 0);
  const remaining = Math.round((poValue - othersRequested) * 100) / 100;
  if (requestedAmount - remaining > 0.005) {
    return {
      error: `Only ${formatExactAmount(remaining)} available on this PO (${formatExactAmount(poValue)} total, ${formatExactAmount(othersRequested)} on other installments).`,
    };
  }

  // Update fields + flip back to pending_approval in one guarded write.
  const { data: updated, error: upErr } = await supabase
    .from("request_installments")
    .update({
      requested_amount: requestedAmount,
      payment_due_date: paymentDueDate,
      date_of_work_completion: dateOfWorkCompletion,
      tentative_invoice_date: tentativeInvoiceDate,
      purpose: note,
      status: "pending_approval",
      rejection_reason: null,
      return_reason: null,
    })
    .eq("id", installmentId)
    .in("status", ["rejected", "returned_for_correction", "draft"])
    .select("id");
  if (upErr) return { error: upErr.message };
  if (!updated || updated.length === 0) {
    return { error: "Installment status changed while you were editing. Refresh and retry." };
  }

  await admin.from("status_history").insert({
    request_id: inst.request_id,
    installment_id: installmentId,
    actor_id: user.id,
    from_status: inst.status,
    to_status: "pending_approval",
    comment: `Installment #${inst.installment_number} edited and resubmitted (${formatExactAmount(requestedAmount)})`,
  });

  // New supporting documents for the corrected submission
  if (files.length > 0) {
    const rows: Array<Record<string, unknown>> = [];
    for (const file of files) {
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${inst.request_id}/installments/${installmentId}/${Date.now()}-${safe}`;
      const buf = await file.arrayBuffer();
      const { error: uploadErr } = await admin.storage
        .from("request-attachments")
        .upload(path, buf, { contentType: file.type || "application/octet-stream" });
      if (uploadErr) {
        console.error("attachment upload failed", { path, message: uploadErr.message });
        continue;
      }
      rows.push({
        request_id: inst.request_id,
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
    requestId: inst.request_id,
    requestNumber: thread.request_number as string,
    installmentAmount: requestedAmount,
    installmentNumber: inst.installment_number as number,
    actorId: user.id,
  });

  revalidatePath(`/requests/${inst.request_id}`);
  revalidatePath("/approvals");
  return { info: `Installment #${inst.installment_number} resubmitted for approval.` };
}

// ---------------------------------------------------------------------------
// Delete a supporting document (submitter / admin, request-stage only)
// ---------------------------------------------------------------------------

export async function deleteAttachment(formData: FormData): Promise<void> {
  const attachmentId = String(formData.get("attachment_id") ?? "");
  const requestId = String(formData.get("request_id") ?? "");
  if (!attachmentId || !requestId) return;

  const supabase = await createClient();
  const admin = createAdminClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const [{ data: att }, { data: thread }, { data: roleRows }] = await Promise.all([
    admin
      .from("attachments")
      .select("id, request_id, stage, storage_path")
      .eq("id", attachmentId)
      .single(),
    admin.from("payment_requests").select("submitter_id").eq("id", requestId).single(),
    supabase.from("user_roles").select("role").eq("user_id", user.id),
  ]);
  // Only request-stage docs are deletable — payment proofs and invoices are
  // audit records and stay immutable.
  if (!att || att.request_id !== requestId || att.stage !== "request") return;
  const roles = new Set(((roleRows ?? []) as { role: string }[]).map((r) => r.role));
  if (thread?.submitter_id !== user.id && !roles.has("admin")) return;

  await admin.storage.from("request-attachments").remove([att.storage_path as string]);
  await admin.from("attachments").delete().eq("id", attachmentId);
  revalidatePath(`/requests/${requestId}`);
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
  try {
    await requireRole("approver", "accounts", "admin");
  } catch {
    return { error: "You don't have permission to recode a line." };
  }
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
  try {
    await requireRole("accounts");
  } catch {
    return { error: "Only Accounts can do that." };
  }
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
    const inst = await transitionInstallment(installmentId, "uploaded_in_bank", "Marked uploaded in bank", {
      // The queue marker has done its job once this is in the bank.
      queued_for_upload_at: null,
      queued_by: null,
    });
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
  try {
    await requireRole("accounts");
  } catch {
    return { error: "Only Accounts can do that." };
  }
  const installmentId = String(formData.get("installment_id") ?? "");
  const payment_date = String(formData.get("payment_date") ?? "");
  const paid_amount = Number(formData.get("paid_amount") ?? 0);
  const utr_reference = String(formData.get("utr_reference") ?? "").trim();
  const paying_bank_account = String(formData.get("paying_bank_account") ?? "").trim() || null;
  const proof = formData.get("proof");
  const oversizedProof = oversizedFile([proof]);
  if (oversizedProof) return { error: oversizedProof };
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

  // Move the status FIRST. transitionInstallment re-reads and guards on the
  // from-status, so if an approver pulled the approval back while this form
  // was open we fail here — before any money row or proof is written.
  const { count: invCount } = await admin
    .from("attachments")
    .select("id", { count: "exact", head: true })
    .eq("request_id", inst.request_id)
    .eq("stage", "invoice")
    .like("storage_path", `%/installments/${installmentId}/%`);
  const nextStatus = (invCount ?? 0) > 0 ? "payment_processed" : "invoice_pending";
  try {
    await transitionInstallment(installmentId, nextStatus, "Payment processed");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const { error: recErr } = await supabase
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
  if (recErr) return { error: `Status moved but the payment details didn't save: ${recErr.message}` };

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

  revalidatePath(`/requests/${inst.request_id}`);
  revalidatePath("/accounts");
  return { info: "Payment recorded." };
}

export async function uploadInstallmentInvoice(
  _prev: RequestState,
  formData: FormData,
): Promise<RequestState> {
  try {
    await requireRole("accounts");
  } catch {
    return { error: "Only Accounts can do that." };
  }
  const installmentId = String(formData.get("installment_id") ?? "");
  const invoice = formData.get("invoice");
  if (!installmentId || !(invoice instanceof File) || invoice.size === 0) {
    return { error: "Pick an invoice file." };
  }
  const oversizedInvoice = oversizedFile([invoice]);
  if (oversizedInvoice) return { error: oversizedInvoice };

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

// ---------------------------------------------------------------------------
// Recall / un-approve — pulling a request back before money moves
// ---------------------------------------------------------------------------

/**
 * Submitter withdraws their own installment while it is still awaiting a
 * decision. It becomes a draft they can edit and re-submit; approvers stop
 * seeing it in their queue and its amount frees up on the PO.
 */
export async function recallInstallment(
  _prev: RequestState,
  formData: FormData,
): Promise<RequestState> {
  const installmentId = String(formData.get("installment_id") ?? "");
  if (!installmentId) return { error: "Missing installment." };

  const admin = createAdminClient();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { data: inst } = await admin
    .from("request_installments")
    .select("id, request_id, installment_number, status")
    .eq("id", installmentId)
    .single();
  if (!inst) return { error: "Installment not found." };
  if (!["pending_approval", "clarification_required"].includes(inst.status as string)) {
    return { error: "Only an installment still awaiting approval can be recalled." };
  }

  const { data: thread } = await admin
    .from("payment_requests")
    .select("id, submitter_id")
    .eq("id", inst.request_id)
    .single();
  if (!thread || thread.submitter_id !== user.id) {
    return { error: "Only the person who raised it can recall it." };
  }
  // Never let a recall free up money that already moved. The test is an
  // actual payment, not the mere existence of a payment_records row — a row
  // pulled back out of a bank file keeps its batch reference, and treating
  // that as "already paid" would block the installment forever.
  if (await hasSettledPayment(admin, installmentId)) {
    return { error: "A payment is already recorded against this installment — it can't be recalled." };
  }

  try {
    await transitionInstallment(installmentId, "draft", "Recalled by submitter");
  } catch (e) {
    return { error: (e as Error).message };
  }

  revalidatePath(`/requests/${inst.request_id}`);
  revalidatePath("/requests");
  revalidatePath("/approvals");
  return { info: `Installment #${inst.installment_number} recalled — it's now a draft.` };
}

/**
 * Approver takes an approval back while Accounts has not yet uploaded the
 * payment to the bank. The installment returns to the approval queue.
 */
export async function unapproveInstallment(
  _prev: RequestState,
  formData: FormData,
): Promise<RequestState> {
  const installmentId = String(formData.get("installment_id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim() || null;
  if (!installmentId) return { error: "Missing installment." };

  const admin = createAdminClient();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { data: roleRows } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
  const roles = new Set(((roleRows ?? []) as { role: string }[]).map((r) => r.role));
  if (!roles.has("approver") && !roles.has("admin")) {
    return { error: "Only an approver can pull an approval back." };
  }

  const { data: inst } = await admin
    .from("request_installments")
    .select("id, request_id, installment_number, status")
    .eq("id", installmentId)
    .single();
  if (!inst) return { error: "Installment not found." };
  if (inst.status !== "approved") {
    return { error: "Only an approved installment that Accounts hasn't picked up yet can be pulled back." };
  }
  if (await hasSettledPayment(admin, installmentId)) {
    return { error: "A payment has already been recorded against this — it can't be pulled back." };
  }

  try {
    await transitionInstallment(installmentId, "pending_approval", reason ?? "Approval withdrawn", {
      approver_id: null,
      approved_at: null,
    });
  } catch (e) {
    return { error: (e as Error).message };
  }

  // Nobody is watching the approvals queue for a row that silently reappeared
  // — tell the submitter, and Accounts, that it left their queue.
  const { data: thread } = await admin
    .from("payment_requests")
    .select("request_number, submitter_id")
    .eq("id", inst.request_id)
    .single();
  const { data: accRows } = await admin.from("user_roles").select("user_id").eq("role", "accounts");
  const recipients = Array.from(new Set([
    thread?.submitter_id as string | undefined,
    ...((accRows ?? []) as { user_id: string }[]).map((r) => r.user_id),
  ].filter((x): x is string => !!x && x !== user.id)));
  if (recipients.length > 0) {
    const label = `${shortRequestNumber(thread?.request_number as string)} · installment #${inst.installment_number}`;
    await admin.from("notifications").insert(recipients.map((recipient_id) => ({
      recipient_id,
      actor_id: user.id,
      kind: "approval_withdrawn",
      request_id: inst.request_id,
      body: `Approval withdrawn on ${label}${reason ? ` — ${reason}` : ""}`,
    })));
    await sendPushToUsers(recipients, {
      title: "Approval withdrawn",
      body: label,
      url: `/requests/${inst.request_id}`,
      tag: `inst-${installmentId}`,
    });
  }

  revalidatePath(`/requests/${inst.request_id}`);
  revalidatePath("/approvals");
  revalidatePath("/accounts");
  return { info: `Installment #${inst.installment_number} is back with the approvers.` };
}

/**
 * Submit a recalled draft back for approval, unchanged. (To change the
 * amount or dates first, use edit & resubmit.)
 */
export async function submitDraftInstallment(
  _prev: RequestState,
  formData: FormData,
): Promise<RequestState> {
  {
    const supabase0 = await createClient();
    const { data: { user: u0 } } = await supabase0.auth.getUser();
    if (!u0) return { error: "Not signed in." };
    const denied0 = await cannotRaise(supabase0, u0.id);
    if (denied0) return { error: denied0 };
  }
  const installmentId = String(formData.get("installment_id") ?? "");
  if (!installmentId) return { error: "Missing installment." };

  const admin = createAdminClient();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { data: inst } = await admin
    .from("request_installments")
    .select("id, request_id, installment_number, status, requested_amount")
    .eq("id", installmentId)
    .single();
  if (!inst) return { error: "Installment not found." };
  if (inst.status !== "draft") return { error: "This installment isn't a draft." };

  const { data: thread } = await admin
    .from("payment_requests")
    .select("id, request_number, submitter_id, vendor_id")
    .eq("id", inst.request_id)
    .single();
  if (!thread || thread.submitter_id !== user.id) {
    return { error: "Only the person who raised it can submit it." };
  }

  // Re-check the PO ceiling: other installments may have moved while this sat
  // in draft.
  const [linesRes, instRes] = await Promise.all([
    admin.from("request_line_items").select("quantity, rate").eq("request_id", inst.request_id),
    admin.from("request_installments").select("id, requested_amount, status").eq("request_id", inst.request_id),
  ]);
  const poValue = Math.round((linesRes.data ?? []).reduce((s, l) => s + Number(l.quantity) * Number(l.rate), 0) * 100) / 100;
  const othersRequested = (instRes.data ?? [])
    .filter((i) => i.id !== installmentId && !["cancelled", "rejected", "draft"].includes(i.status as string))
    .reduce((s, i) => s + Number(i.requested_amount), 0);
  const remaining = Math.round((poValue - othersRequested) * 100) / 100;
  const amount = Number(inst.requested_amount);
  if (amount - remaining > 0.005) {
    return {
      error: `Only ${formatExactAmount(remaining)} is left on this PO — edit the amount before submitting.`,
    };
  }

  try {
    await transitionInstallment(installmentId, "pending_approval", "Draft submitted", {
      submitted_at: new Date().toISOString(),
    });
  } catch (e) {
    return { error: (e as Error).message };
  }

  await notifyApprovers({
    requestId: inst.request_id,
    requestNumber: thread.request_number as string,
    installmentAmount: amount,
    installmentNumber: inst.installment_number as number,
    actorId: user.id,
  });

  revalidatePath(`/requests/${inst.request_id}`);
  revalidatePath("/requests");
  revalidatePath("/approvals");
  return { info: `Installment #${inst.installment_number} submitted for approval.` };
}

/**
 * Discard a draft. If it was the thread's only installment the whole request
 * goes too — a PO nobody is asking to pay is just clutter.
 */
export async function deleteDraftInstallment(
  _prev: RequestState,
  formData: FormData,
): Promise<RequestState> {
  const installmentId = String(formData.get("installment_id") ?? "");
  if (!installmentId) return { error: "Missing installment." };

  const admin = createAdminClient();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { data: inst } = await admin
    .from("request_installments")
    .select("id, request_id, installment_number, status")
    .eq("id", installmentId)
    .single();
  if (!inst) return { error: "Installment not found." };
  if (inst.status !== "draft") return { error: "Only a draft can be deleted." };

  const { data: thread } = await admin
    .from("payment_requests")
    .select("id, submitter_id")
    .eq("id", inst.request_id)
    .single();
  if (!thread || thread.submitter_id !== user.id) {
    return { error: "Only the person who raised it can delete it." };
  }
  // Never discard something money has touched.
  const { count: payCount } = await admin
    .from("payment_records")
    .select("installment_id", { count: "exact", head: true })
    .eq("installment_id", installmentId);
  if ((payCount ?? 0) > 0) {
    return { error: "A payment is recorded against this — it can't be deleted." };
  }

  const { count: siblings } = await admin
    .from("request_installments")
    .select("id", { count: "exact", head: true })
    .eq("request_id", inst.request_id)
    .neq("id", installmentId);

  if ((siblings ?? 0) === 0) {
    // Last one out deletes the request; children cascade.
    const { error } = await admin.from("payment_requests").delete().eq("id", inst.request_id);
    if (error) return { error: error.message };
    revalidatePath("/requests");
    revalidatePath("/approvals");
    redirect("/requests");
  }

  const { error } = await admin.from("request_installments").delete().eq("id", installmentId);
  if (error) return { error: error.message };
  revalidatePath(`/requests/${inst.request_id}`);
  revalidatePath("/requests");
  return { info: `Draft installment #${inst.installment_number} deleted.` };
}

/**
 * Rewrite a thread's PO breakdown (line items = PO value + CoA allocation).
 *
 * Only while nothing has been approved: once an approver has signed off, the
 * PO they approved against must not shift underneath them. Rejected and draft
 * installments don't count as approved.
 */
export async function updateThreadLineItems(
  _prev: RequestState,
  formData: FormData,
): Promise<RequestState> {
  {
    const supabase0 = await createClient();
    const { data: { user: u0 } } = await supabase0.auth.getUser();
    if (!u0) return { error: "Not signed in." };
    const denied0 = await cannotRaise(supabase0, u0.id);
    if (denied0) return { error: denied0 };
  }
  const requestId = String(formData.get("request_id") ?? "");
  if (!requestId) return { error: "Missing request." };

  let lines: LineIn[] = [];
  try {
    lines = JSON.parse(String(formData.get("line_items") ?? "[]")) as LineIn[];
  } catch {
    return { error: "Invalid line items payload." };
  }
  if (lines.length === 0) return { error: "Add at least one line item." };
  const badLine = lines.findIndex(
    (l) =>
      (!l.coa_account_id && !(String(l.coa ?? "").trim() && String(l.category ?? "").trim())) ||
      !(l.quantity > 0) ||
      !(l.rate >= 0),
  );
  if (badLine !== -1) return { error: `Line ${badLine + 1}: category + quantity + rate all required.` };

  const admin = createAdminClient();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { data: thread } = await admin
    .from("payment_requests")
    .select("id, submitter_id")
    .eq("id", requestId)
    .single();
  if (!thread) return { error: "Request not found." };
  const { data: roleRows } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
  const roles = new Set(((roleRows ?? []) as { role: string }[]).map((r) => r.role));
  if (
    !(await isThreadParticipant(admin, thread.id as string, user.id, thread.submitter_id as string)) &&
    !roles.has("admin")
  ) {
    return { error: "Only the person who raised this, or someone CC'd on it, can edit the PO." };
  }

  const { data: insts } = await admin
    .from("request_installments")
    .select("id, status, requested_amount")
    .eq("request_id", requestId);
  const LOCKED = ["approved", "uploaded_in_bank", "invoice_pending", "payment_processed", "closed"];
  const locked = (insts ?? []).filter((i) => LOCKED.includes(i.status as string));
  if (locked.length > 0) {
    return {
      error: "The PO can't be changed once an installment is approved — recall or reject it first.",
    };
  }

  const poValue = Math.round(lines.reduce((s, l) => s + l.quantity * l.rate, 0) * 100) / 100;
  if (poValue <= 0) return { error: "PO value must be positive." };
  // Anything still live (pending approval) must still fit inside the new PO.
  const liveTotal = (insts ?? [])
    .filter((i) => !["cancelled", "rejected", "draft"].includes(i.status as string))
    .reduce((s, i) => s + Number(i.requested_amount), 0);
  if (liveTotal - poValue > 0.005) {
    return {
      error: `New PO ${formatExactAmount(poValue)} is below the ${formatExactAmount(liveTotal)} already requested — lower the installment first.`,
    };
  }

  const coaError = await resolveLineAccounts(supabase, lines);
  if (coaError) return { error: coaError };

  // Replace wholesale: line ids aren't referenced anywhere else.
  const { error: delErr } = await admin.from("request_line_items").delete().eq("request_id", requestId);
  if (delErr) return { error: delErr.message };
  const { error: insErr } = await admin.from("request_line_items").insert(
    lines.map((l, i) => ({
      request_id: requestId,
      coa_account_id: l.coa_account_id,
      quantity: l.quantity,
      rate: l.rate,
      sort_order: i,
    })),
  );
  if (insErr) return { error: insErr.message };

  await admin.from("status_history").insert({
    request_id: requestId,
    actor_id: user.id,
    from_status: "draft",
    to_status: "draft",
    comment: `PO revised to ${formatExactAmount(poValue)} (${lines.length} line${lines.length === 1 ? "" : "s"})`,
  });

  revalidatePath(`/requests/${requestId}`);
  revalidatePath("/requests");
  return { info: `PO updated to ${formatExactAmount(poValue)}.` };
}

export async function closeInstallment(
  _prev: RequestState,
  formData: FormData,
): Promise<RequestState> {
  const installmentId = String(formData.get("installment_id") ?? "");
  if (!installmentId) return { error: "Missing installment." };
  try {
    await requireRole("accounts");
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
  const oversized = oversizedFile(files);
  if (oversized) return { error: oversized };

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

  // Any message on a thread with pending installments flags them as
  // "Clarification required" — active discussion means the approver should
  // read before acting. Approving directly from that state is allowed and
  // is what "resolves" the discussion.
  {
    const { data: pendingInsts } = await supabase
      .from("request_installments")
      .select("id, status")
      .eq("request_id", requestId)
      .eq("status", "pending_approval");
    for (const inst of pendingInsts ?? []) {
      try {
        await transitionInstallment(inst.id, "clarification_required", body.slice(0, 200) || "New discussion message");
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
      if (uploadErr) {
        console.error("attachment upload failed", { path, message: uploadErr.message });
        continue;
      }
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

/**
 * Admin-only permanent delete. The work lives in lib/purge-request.ts so the
 * deactivation flow can delete a departing user's requests the same way.
 */
export async function deleteRequestAsAdmin(
  _prev: RequestState,
  formData: FormData,
): Promise<RequestState> {
  const requestId = String(formData.get("request_id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim() || null;
  if (!requestId) return { error: "Missing request." };

  let user;
  try {
    ({ user } = await requireRole("admin"));
  } catch {
    return { error: "Only an admin can delete a request." };
  }

  const admin = createAdminClient();
  const impact = await getDeletionImpact(admin, requestId);
  if (!impact) return { error: "That request no longer exists." };

  // Deleting money that has already left the bank is a decision, not a typo:
  // make the admin restate the request number.
  if (impact.totalPaid > 0) {
    const typed = String(formData.get("confirm_number") ?? "").trim().toUpperCase();
    if (!typed || !impact.requestNumber.toUpperCase().endsWith(typed)) {
      return {
        error: `${impact.requestNumber} has \u20b9${impact.totalPaid.toLocaleString("en-IN")} recorded as paid. Type the request number exactly to confirm.`,
      };
    }
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("email")
    .eq("id", user.id)
    .maybeSingle();

  const err = await purgeRequest(
    admin,
    requestId,
    { id: user.id, email: (profile as { email?: string } | null)?.email ?? null },
    reason,
  );
  if (err) return { error: err };

  revalidatePath("/requests");
  revalidatePath("/approvals");
  revalidatePath("/accounts");
  revalidatePath("/dashboard");
  redirect(`/requests?deleted=${encodeURIComponent(impact.requestNumber)}`);
}

/**
 * Accounts move installments between the three bank-file stages.
 *
 *   Approved  --queue-->  To upload  --download-->  In bank
 *      ^                      |                        |
 *      +------- unqueue ------+                        |
 *      +--------------- recall ------------------------+
 *
 * Queue/unqueue only touch the staging marker; the status stays 'approved'
 * throughout (migration 027). Recall is the real correction path — an upload
 * that failed at the bank, or a file that shouldn't have gone — so it moves
 * the status back and undoes the bank-upload half of the payment record.
 */
export async function queueForBankUpload(
  _prev: RequestState,
  formData: FormData,
): Promise<RequestState> {
  const ids = formData.getAll("installment_ids").map(String).filter(Boolean);
  const mode = String(formData.get("action") ?? "queue");
  if (ids.length === 0) return { error: "Nothing selected." };

  let user;
  try {
    ({ user } = await requireRole("accounts"));
  } catch {
    return { error: "Only Accounts can do that." };
  }

  const admin = createAdminClient();

  // ---- Take it back out of the queue -------------------------------------
  if (mode === "unqueue") {
    const { data, error } = await admin
      .from("request_installments")
      // TDS is set on the request page and survives this — it's a decision
      // about the invoice, not about which run the payment goes out in.
      .update({ queued_for_upload_at: null, queued_by: null })
      .in("id", ids)
      .eq("status", "approved")
      .select("id");
    if (error) return { error: error.message };
    revalidatePath("/accounts");
    return { info: `${(data ?? []).length} moved back to Approved.` };
  }

  // ---- Pull it back out of the bank --------------------------------------
  if (mode === "recall") {
    // Anything with money actually recorded against it is not a mistake to
    // undo — that is a paid installment, and it belongs in the paid flow.
    const { data: paid } = await admin
      .from("payment_records")
      .select("installment_id, paid_amount, utr_reference")
      .in("installment_id", ids);
    const settled = new Set(
      ((paid ?? []) as { installment_id: string; paid_amount: number | null; utr_reference: string | null }[])
        .filter((p) => p.paid_amount != null || !!p.utr_reference)
        .map((p) => p.installment_id),
    );
    const recallable = ids.filter((id) => !settled.has(id));
    if (recallable.length === 0) {
      return { error: "Those already have a payment recorded against them — record or close them instead." };
    }

    // Guarded on status, so a concurrent "mark paid" can't be overtaken.
    const { data: moved, error } = await admin
      .from("request_installments")
      // Back to Approved, NOT back into the queue. A payment that has already
      // been handed to the bank should not re-enter the next file because
      // someone clicked once — Accounts queue it again deliberately.
      .update({ status: "approved" })
      .in("id", recallable)
      .eq("status", "uploaded_in_bank")
      .select("id, request_id, installment_number");
    if (error) return { error: error.message };

    const movedRows = (moved ?? []) as { id: string; request_id: string; installment_number: number }[];
    if (movedRows.length > 0) {
      // The batch reference is deliberately left in place: it is the only
      // structured record that this payment was once in a file, and that is
      // exactly what you need if the bank turns out to have processed it.
      await admin.from("status_history").insert(
        movedRows.map((r) => ({
          request_id: r.request_id,
          installment_id: r.id,
          actor_id: user.id,
          from_status: "uploaded_in_bank",
          to_status: "approved",
          comment: "Pulled back out of the bank file by Accounts",
        })),
      );
      movedRows.forEach((r) => revalidatePath(`/requests/${r.request_id}`));
    }

    revalidatePath("/accounts");
    const skipped = ids.length - movedRows.length;
    return {
      info:
        skipped > 0
          ? `${movedRows.length} moved back to Approved. ${skipped} left alone — already paid or no longer in the bank. Queue them again to include them in a file.`
          : `${movedRows.length} moved back to Approved — queue them again to include them in a file.`,
    };
  }

  // ---- Queue it for the next file ----------------------------------------
  // Re-read rather than trusting the form: the vendor may have been
  // un-approved, or the installment moved on, since the page was rendered.
  const { data: rows } = await admin
    .from("request_installments")
    .select(
      `id, status, request:payment_requests!inner(
         request_number,
         vendor:vendors(status, bank_account_number, bank_ifsc))`,
    )
    .in("id", ids);

  type Row = {
    id: string;
    status: string;
    request: {
      request_number: string;
      vendor: { status: string; bank_account_number: string | null; bank_ifsc: string | null } | null;
    };
  };

  const ok: string[] = [];
  const held: string[] = [];
  for (const r of ((rows ?? []) as unknown as Row[])) {
    const v = r.request?.vendor;
    const payable =
      r.status === "approved" &&
      v?.status === "approved" &&
      !!v.bank_account_number &&
      !!v.bank_ifsc;
    if (payable) ok.push(r.id);
    else held.push(shortRequestNumber(r.request?.request_number));
  }

  if (ok.length > 0) {
    // Guard on status again in the write itself, so a concurrent un-approval
    // can't be overtaken between the read above and here.
    const { error } = await admin
      .from("request_installments")
      .update({ queued_for_upload_at: new Date().toISOString(), queued_by: user.id })
      .in("id", ok)
      .eq("status", "approved");
    if (error) return { error: error.message };
  }

  revalidatePath("/accounts");
  if (held.length > 0) {
    return {
      info: `${ok.length} moved to To upload. Held back: ${held.join(", ")} — vendor not approved or bank details missing.`,
    };
  }
  return { info: `${ok.length} moved to To upload.` };
}

/**
 * TDS withheld on one installment, set by Accounts on the request page.
 *
 * Only while the installment is still approved — once it is in a bank file
 * the amount has already gone, and changing the deduction after the fact
 * would make the record disagree with what the bank was told.
 */
export async function setInstallmentTds(
  _prev: RequestState,
  formData: FormData,
): Promise<RequestState> {
  const installmentId = String(formData.get("installment_id") ?? "");
  const raw = String(formData.get("tds_amount") ?? "").trim();
  if (!installmentId) return { error: "Missing installment." };

  try {
    await requireRole("accounts");
  } catch {
    return { error: "Only Accounts can set TDS." };
  }

  const tds = raw === "" ? 0 : Number(raw);
  if (!Number.isFinite(tds) || tds < 0) return { error: "Enter a valid TDS amount." };

  const admin = createAdminClient();
  const { data: inst } = await admin
    .from("request_installments")
    .select("id, request_id, status, requested_amount")
    .eq("id", installmentId)
    .maybeSingle();
  if (!inst) return { error: "Installment not found." };

  const requested = Number((inst as { requested_amount: number }).requested_amount);
  if (tds > requested) {
    return { error: `TDS can't be more than the ${formatExactAmount(requested)} approved.` };
  }
  if ((inst as { status: string }).status !== "approved") {
    return { error: "TDS can only be set before the payment goes to the bank." };
  }

  const { error } = await admin
    .from("request_installments")
    .update({
      tds_amount: tds,
      tds_percent: tds > 0 && requested > 0 ? Math.round((tds / requested) * 10000) / 100 : null,
      tds_section: String(formData.get("tds_section") ?? "").trim() || null,
    })
    .eq("id", installmentId)
    .eq("status", "approved");
  if (error) return { error: error.message };

  revalidatePath(`/requests/${(inst as { request_id: string }).request_id}`);
  revalidatePath("/accounts");
  return {
    info: tds > 0 ? `TDS set — vendor gets ${formatExactAmount(requested - tds)}.` : "TDS cleared.",
  };
}
