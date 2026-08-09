"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendPushToUsers } from "@/lib/push";

export type ProcurementState = { error?: string; info?: string } | undefined;

/**
 * Procurement requests — the step before a payment request.
 *
 * Every state change lives here rather than in an RLS policy, for the reason
 * migration 026 exists: a policy can say who may update a row, but not that an
 * approver may set the status and not the estimated amount. So the table has
 * no UPDATE policy at all, writes go through the service-role client, and the
 * gate is the role check at the top of each action.
 *
 * Server Actions dispatch by id and can be POSTed to any route, so none of
 * these may rely on the page having checked anything.
 */

async function currentUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_active")
    .eq("id", user.id)
    .maybeSingle();
  if ((profile as { is_active?: boolean } | null)?.is_active === false) {
    throw new Error("Your account is inactive. Contact an admin.");
  }
  const { data } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
  const roles = new Set(((data ?? []) as { role: string }[]).map((r) => r.role));
  return { supabase, user, roles };
}

async function requireAnyRole(...allowed: string[]) {
  const ctx = await currentUser();
  if (!allowed.some((r) => ctx.roles.has(r))) {
    throw new Error("You don't have permission to do that.");
  }
  return ctx;
}

/** Everyone who should hear that something needs their attention. */
async function notifyRole(
  role: string,
  opts: { actorId: string; procurementId: string; body: string; title: string; url: string },
) {
  const admin = createAdminClient();
  const { data } = await admin.from("user_roles").select("user_id").eq("role", role);
  const ids = ((data ?? []) as { user_id: string }[])
    .map((r) => r.user_id)
    .filter((id) => id !== opts.actorId);
  if (ids.length === 0) return;
  await admin.from("notifications").insert(
    ids.map((recipient_id) => ({
      recipient_id,
      actor_id: opts.actorId,
      kind: "mentioned",
      procurement_request_id: opts.procurementId,
      body: opts.body,
    })),
  );
  await sendPushToUsers(ids, {
    title: opts.title,
    body: opts.body,
    url: opts.url,
    tag: `procurement-${opts.procurementId}`,
  });
}

export async function createProcurementRequest(
  _prev: ProcurementState,
  formData: FormData,
): Promise<ProcurementState> {
  try {
    const { supabase, user } = await requireAnyRole("requester", "admin");

    const title = String(formData.get("title") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim();
    const outlet_id = String(formData.get("outlet_id") ?? "");
    const expense_type = String(formData.get("expense_type") ?? "capex");
    if (!title || !description || !outlet_id) {
      return { error: "Title, what's needed, and the branch are all required." };
    }
    if (!["capex", "opex"].includes(expense_type)) return { error: "Pick CapEx or OpEx." };

    const coa = String(formData.get("coa") ?? "").trim() || null;
    const coa_category = String(formData.get("coa_category") ?? "").trim() || null;
    const coa_account_id = String(formData.get("coa_account_id") ?? "") || null;
    // The top level is what makes the request classifiable at all; the account
    // beneath it can legitimately be left off when the sub category has none.
    if (!coa) return { error: "Pick a category." };

    const admin = createAdminClient();
    const { data: numberRes } = await admin.rpc("next_procurement_number");
    const request_number = typeof numberRes === "string" ? numberRes : null;
    if (!request_number) return { error: "Couldn't reserve a request number. Try again." };

    // Inserted through the USER'S client on purpose. This is the one write
    // where RLS should decide: procurement_insert re-checks the requester role
    // and may_raise_for_outlet, so a crafted POST cannot raise against a branch
    // the person was never granted.
    const { data, error } = await supabase
      .from("procurement_requests")
      .insert({
        request_number,
        submitter_id: user.id,
        title,
        description,
        outlet_id,
        expense_type,
        coa,
        coa_category,
        coa_account_id,
      })
      .select("id")
      .single();
    if (error) {
      return error.message.toLowerCase().includes("row-level security")
        ? { error: "You can't raise for that branch. Ask an admin to assign it." }
        : { error: error.message };
    }

    const id = (data as { id: string }).id;

    const { data: me } = await admin.from("profiles").select("full_name").eq("id", user.id).single();
    await notifyRole("approver", {
      actorId: user.id,
      procurementId: id,
      title: `${(me as { full_name: string } | null)?.full_name ?? "Someone"} raised a procurement request`,
      body: `${request_number} · ${title}`,
      url: `/procurement/${id}`,
    });

    revalidatePath("/procurement");
    return { info: `${request_number} raised.` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function approveProcurementRequest(
  _prev: ProcurementState,
  formData: FormData,
): Promise<ProcurementState> {
  try {
    const { user } = await requireAnyRole("approver", "admin");
    const id = String(formData.get("id") ?? "");
    if (!id) return { error: "Missing request." };

    const admin = createAdminClient();
    const { data: row } = await admin
      .from("procurement_requests")
      .select("submitter_id, request_number, title, status")
      .eq("id", id)
      .maybeSingle();
    const req = row as
      | { submitter_id: string; request_number: string; title: string; status: string }
      | null;
    if (!req) return { error: "That request no longer exists." };
    // Same rule as payments: you cannot sanction your own spend. Holding both
    // roles is normal here; approving your own request is not.
    if (req.submitter_id === user.id) {
      return { error: "You raised this — someone else has to approve it." };
    }

    // Status is re-checked in the WHERE clause so two approvers clicking at
    // once cannot both succeed.
    const { data: updated, error } = await admin
      .from("procurement_requests")
      .update({ status: "approved", approver_id: user.id, approved_at: new Date().toISOString() })
      .eq("id", id)
      .eq("status", "pending_approval")
      .select("id");
    if (error) return { error: error.message };
    if (!updated || updated.length === 0) {
      return { error: "Its status has changed — refresh the page." };
    }

    // Straight to the person who raised it: they source it and record the PO.
    await admin.from("notifications").insert({
      recipient_id: req.submitter_id,
      actor_id: user.id,
      kind: "request_approved",
      procurement_request_id: id,
      body: `${req.request_number} approved — go ahead and get the PO`,
    });
    await sendPushToUsers([req.submitter_id], {
      title: "Approved — you can get the PO",
      body: `${req.request_number} · ${req.title}`,
      url: `/procurement/${id}`,
      tag: `procurement-${id}`,
    });

    revalidatePath("/procurement");
    revalidatePath(`/procurement/${id}`);
    return { info: "Approved — procurement can start sourcing." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function rejectProcurementRequest(
  _prev: ProcurementState,
  formData: FormData,
): Promise<ProcurementState> {
  try {
    const { user } = await requireAnyRole("approver", "admin");
    const id = String(formData.get("id") ?? "");
    const reason = String(formData.get("reason") ?? "").trim();
    if (!id) return { error: "Missing request." };
    if (reason.length < 3) return { error: "Give a reason — the person who raised it will see it." };

    const admin = createAdminClient();
    const { data: updated, error } = await admin
      .from("procurement_requests")
      .update({
        status: "rejected",
        approver_id: user.id,
        approved_at: new Date().toISOString(),
        rejection_reason: reason.slice(0, 500),
      })
      .eq("id", id)
      .eq("status", "pending_approval")
      .select("id, submitter_id, request_number");
    if (error) return { error: error.message };
    if (!updated || updated.length === 0) {
      return { error: "Its status has changed — refresh the page." };
    }
    const row = updated[0] as { submitter_id: string; request_number: string };

    await admin.from("notifications").insert({
      recipient_id: row.submitter_id,
      actor_id: user.id,
      kind: "request_rejected",
      procurement_request_id: id,
      body: `${row.request_number} rejected · ${reason.slice(0, 100)}`,
    });
    await sendPushToUsers([row.submitter_id], {
      title: "Procurement request rejected",
      body: `${row.request_number} · ${reason.slice(0, 100)}`,
      url: `/procurement/${id}`,
      tag: `procurement-${id}`,
    });

    revalidatePath("/procurement");
    revalidatePath(`/procurement/${id}`);
    return { info: "Rejected." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/**
 * Record the PO once it has been obtained. The handover point: from here a
 * payment request can be raised against it.
 *
 * Done by the person who RAISED the request, not a separate procurement team —
 * the owner's call, and it matches how the company works: whoever needs the
 * thing goes and sources it. So the gate is ownership, not a role.
 */
export async function recordPurchaseOrder(
  _prev: ProcurementState,
  formData: FormData,
): Promise<ProcurementState> {
  try {
    const { user, roles } = await currentUser();
    const id = String(formData.get("id") ?? "");
    const po_reference = String(formData.get("po_reference") ?? "").trim();
    const po_vendor_id = String(formData.get("po_vendor_id") ?? "") || null;
    if (!id) return { error: "Missing request." };
    if (!po_reference) return { error: "Enter the PO number." };

    const admin = createAdminClient();
    const { data: owner } = await admin
      .from("procurement_requests")
      .select("submitter_id")
      .eq("id", id)
      .maybeSingle();
    const ownerRow = owner as { submitter_id: string } | null;
    if (!ownerRow) return { error: "That request no longer exists." };
    if (ownerRow.submitter_id !== user.id && !roles.has("admin")) {
      return { error: "Only the person who raised this can record the PO." };
    }
    const { data: updated, error } = await admin
      .from("procurement_requests")
      .update({
        status: "po_obtained",
        procured_by: user.id,
        po_reference,
        po_vendor_id,
        po_obtained_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("status", "approved")
      .select("id, submitter_id, request_number");
    if (error) return { error: error.message };
    if (!updated || updated.length === 0) {
      return { error: "It isn't approved, or its status has changed — refresh the page." };
    }
    const row = updated[0] as { submitter_id: string; request_number: string };

    // The submitter is the one doing this now, so telling them is pointless.
    // The approver sanctioned it and will want to know it landed.
    await notifyRole("approver", {
      actorId: user.id,
      procurementId: id,
      title: "PO obtained",
      body: `${row.request_number} · PO ${po_reference}`,
      url: `/procurement/${id}`,
    });

    revalidatePath("/procurement");
    revalidatePath(`/procurement/${id}`);
    return { info: `PO ${po_reference} recorded.` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** The person who raised it can withdraw it, but only before a decision. */
export async function cancelProcurementRequest(
  _prev: ProcurementState,
  formData: FormData,
): Promise<ProcurementState> {
  try {
    const { user, roles } = await currentUser();
    const id = String(formData.get("id") ?? "");
    if (!id) return { error: "Missing request." };

    const admin = createAdminClient();
    const { data: row } = await admin
      .from("procurement_requests")
      .select("submitter_id")
      .eq("id", id)
      .maybeSingle();
    const req = row as { submitter_id: string } | null;
    if (!req) return { error: "That request no longer exists." };
    if (req.submitter_id !== user.id && !roles.has("admin")) {
      return { error: "Only the person who raised this can withdraw it." };
    }

    const { data: updated, error } = await admin
      .from("procurement_requests")
      .update({ status: "cancelled" })
      .eq("id", id)
      .eq("status", "pending_approval")
      .select("id");
    if (error) return { error: error.message };
    if (!updated || updated.length === 0) {
      return { error: "It has already been decided — you can't withdraw it now." };
    }

    revalidatePath("/procurement");
    revalidatePath(`/procurement/${id}`);
    return { info: "Withdrawn." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
