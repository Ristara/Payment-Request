"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendPushToUsers } from "@/lib/push";

export type VendorState = { error?: string; info?: string } | undefined;

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
// Indian mobile: 10 digits starting 6-9, with optional +91 / 91 / 0 prefix.
const PHONE_RE = /^(?:\+91|91|0)?[6-9][0-9]{9}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function createVendor(
  _prev: VendorState,
  formData: FormData,
): Promise<VendorState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const name = String(formData.get("name") ?? "").trim();
  const is_gst_registered = formData.get("is_gst_registered") !== "no";
  const gstinRaw = String(formData.get("gstin") ?? "").trim().toUpperCase();
  const gstin = is_gst_registered ? gstinRaw : null;
  const pan = String(formData.get("pan") ?? "").trim().toUpperCase();
  const bank_account_number_raw = String(formData.get("bank_account_number") ?? "").trim();
  const bank_ifsc_raw = String(formData.get("bank_ifsc") ?? "").trim().toUpperCase();
  const bank_account_number = bank_account_number_raw || null;
  const bank_ifsc = bank_ifsc_raw || null;
  const bank_name = String(formData.get("bank_name") ?? "").trim() || null;
  const bank_branch = String(formData.get("bank_branch") ?? "").trim() || null;
  const phoneRaw = String(formData.get("phone") ?? "").replace(/[\s-]/g, "");
  const email = String(formData.get("email") ?? "").trim().toLowerCase() || null;
  const cheque = formData.get("cancelled_cheque");

  if (!name) return { error: "Vendor name is required." };
  if (is_gst_registered && !GSTIN_RE.test(gstinRaw)) {
    return { error: "GSTIN doesn't look right. Format: 22AAAAA0000A1Z5." };
  }
  if (!PAN_RE.test(pan)) return { error: "PAN doesn't look right. Format: AAAAA0000A." };
  if (!PHONE_RE.test(phoneRaw)) {
    return { error: "Mobile number is required — 10 digits starting 6-9 (e.g. 98765 43210)." };
  }
  // Normalize to bare 10 digits.
  const phone = phoneRaw.replace(/^(\+91|91|0)/, "");
  if (email && !EMAIL_RE.test(email)) {
    return { error: "Email doesn't look right." };
  }
  // Bank details are optional at creation — Accounts fills them in at
  // approval time. If they're provided though, they must be valid.
  if (bank_account_number && bank_account_number.length < 6) {
    return { error: "Bank account number looks too short." };
  }
  if (bank_ifsc && !IFSC_RE.test(bank_ifsc)) {
    return { error: "IFSC doesn't look right. Format: HDFC0001234." };
  }

  // Insert vendor row first (RLS lets requester insert when submitted_by = self)
  const { data: inserted, error: insertErr } = await supabase
    .from("vendors")
    .insert({
      name,
      gstin,
      pan,
      phone,
      email,
      bank_account_number,
      bank_ifsc,
      bank_name,
      bank_branch,
      submitted_by: user.id,
    })
    .select("id")
    .single();

  if (insertErr) {
    if (insertErr.code === "23505") {
      return { error: "A vendor with this GSTIN already exists." };
    }
    return { error: insertErr.message };
  }

  const vendorId = inserted!.id as string;
  const admin = createAdminClient();

  // Upload cheque if provided
  if (cheque instanceof File && cheque.size > 0) {
    const safe = cheque.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${vendorId}/${Date.now()}-${safe}`;
    const buf = await cheque.arrayBuffer();
    const { error: uploadErr } = await admin.storage
      .from("vendor-docs")
      .upload(path, buf, { contentType: cheque.type || "application/octet-stream" });
    if (!uploadErr) {
      await admin.from("vendors").update({ cancelled_cheque_path: path }).eq("id", vendorId);
      await admin.from("attachments").insert({
        vendor_id: vendorId,
        stage: "vendor",
        storage_path: path,
        file_name: cheque.name,
        file_size_bytes: cheque.size,
        mime_type: cheque.type || null,
        uploaded_by: user.id,
      });
    }
  }

  // Notify Accounts team
  const { data: acc } = await admin.from("user_roles").select("user_id").eq("role", "accounts");
  const accIds = ((acc ?? []) as { user_id: string }[]).map((r) => r.user_id);
  if (accIds.length > 0) {
    await admin.from("notifications").insert(accIds.map((recipient_id) => ({
      recipient_id,
      actor_id: user.id,
      kind: "vendor_pending",
      vendor_id: vendorId,
      body: `New vendor to verify: ${name}`,
    })));
    await sendPushToUsers(accIds, {
      title: "New vendor to verify",
      body: name,
      url: `/vendors/${vendorId}`,
      tag: `vendor-${vendorId}`,
    });
  }

  revalidatePath("/vendors");
  redirect(`/vendors/${vendorId}`);
}

export type ApproveState = { error?: string; info?: string } | undefined;

export async function approveVendor(
  _prev: ApproveState,
  formData: FormData,
): Promise<ApproveState> {
  const id = String(formData.get("id") ?? "");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !id) return { error: "Not signed in." };

  // Load current vendor bank + contact details.
  const { data: vendor } = await supabase
    .from("vendors")
    .select("bank_account_number, bank_ifsc, phone")
    .eq("id", id)
    .maybeSingle();
  if (!vendor) return { error: "Vendor not found." };

  // If bank details / phone aren't already on the vendor, accept them from
  // the approval form. Both are required to approve.
  const providedAcct = String(formData.get("bank_account_number") ?? "").trim();
  const providedIfsc = String(formData.get("bank_ifsc") ?? "").trim().toUpperCase();
  const providedName = String(formData.get("bank_name") ?? "").trim() || null;
  const providedBranch = String(formData.get("bank_branch") ?? "").trim() || null;
  const providedPhoneRaw = String(formData.get("phone") ?? "").replace(/[\s-]/g, "");

  const finalAcct = vendor.bank_account_number ?? providedAcct;
  const finalIfsc = vendor.bank_ifsc ?? providedIfsc;
  const finalPhone = vendor.phone ?? providedPhoneRaw;

  if (!finalAcct || finalAcct.length < 6) {
    return { error: "Bank account number is required to approve." };
  }
  if (!finalIfsc || !IFSC_RE.test(finalIfsc)) {
    return { error: "A valid IFSC is required to approve." };
  }
  if (!finalPhone || !PHONE_RE.test(finalPhone)) {
    return { error: "Vendor mobile number is required to approve (10 digits starting 6-9)." };
  }

  const update: Record<string, unknown> = {
    status: "approved",
    verified_by: user.id,
    verified_at: new Date().toISOString(),
  };
  // Only overwrite fields if they were empty and the approver supplied them.
  if (!vendor.bank_account_number && providedAcct) update.bank_account_number = providedAcct;
  if (!vendor.bank_ifsc && providedIfsc) update.bank_ifsc = providedIfsc;
  if (!vendor.phone && providedPhoneRaw) {
    update.phone = providedPhoneRaw.replace(/^(\+91|91|0)/, "");
  }
  if (providedName) update.bank_name = providedName;
  if (providedBranch) update.bank_branch = providedBranch;

  const { error } = await supabase.from("vendors").update(update).eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/vendors");
  revalidatePath(`/vendors/${id}`);
  return { info: "Approved." };
}

export async function rejectVendor(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!id || !reason) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  await supabase
    .from("vendors")
    .update({
      status: "rejected",
      verified_by: user.id,
      verified_at: new Date().toISOString(),
      rejection_reason: reason,
    })
    .eq("id", id);

  revalidatePath("/vendors");
  revalidatePath(`/vendors/${id}`);
}
