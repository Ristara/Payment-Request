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
  const gstin = String(formData.get("gstin") ?? "").trim().toUpperCase();
  const pan = String(formData.get("pan") ?? "").trim().toUpperCase();
  const bank_account_number = String(formData.get("bank_account_number") ?? "").trim();
  const bank_ifsc = String(formData.get("bank_ifsc") ?? "").trim().toUpperCase();
  const bank_name = String(formData.get("bank_name") ?? "").trim() || null;
  const bank_branch = String(formData.get("bank_branch") ?? "").trim() || null;
  const cheque = formData.get("cancelled_cheque");

  if (!name) return { error: "Vendor name is required." };
  if (!GSTIN_RE.test(gstin)) return { error: "GSTIN doesn't look right. Format: 22AAAAA0000A1Z5." };
  if (!PAN_RE.test(pan)) return { error: "PAN doesn't look right. Format: AAAAA0000A." };
  if (!bank_account_number || bank_account_number.length < 6) {
    return { error: "Bank account number looks too short." };
  }
  if (!IFSC_RE.test(bank_ifsc)) return { error: "IFSC doesn't look right. Format: HDFC0001234." };

  // Insert vendor row first (RLS lets requester insert when submitted_by = self)
  const { data: inserted, error: insertErr } = await supabase
    .from("vendors")
    .insert({
      name,
      gstin,
      pan,
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

export async function approveVendor(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !id) return;

  await supabase
    .from("vendors")
    .update({
      status: "approved",
      verified_by: user.id,
      verified_at: new Date().toISOString(),
    })
    .eq("id", id);

  revalidatePath("/vendors");
  revalidatePath(`/vendors/${id}`);
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
