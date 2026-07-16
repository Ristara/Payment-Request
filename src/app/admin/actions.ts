"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { invalidateMasters } from "@/lib/cache";

export type ActionState = { error?: string; info?: string } | undefined;

// ---------------------------------------------------------------------------
// Outlets
// ---------------------------------------------------------------------------

export async function createOutlet(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const code = String(formData.get("code") ?? "").trim().toUpperCase();
  const name = String(formData.get("name") ?? "").trim();
  if (!code || !name) return { error: "Code and name are required." };

  const supabase = await createClient();
  const { error } = await supabase.from("outlets").insert({ code, name });
  if (error) return { error: error.message };

  invalidateMasters();
  revalidatePath("/admin/outlets");
  revalidatePath("/admin");
  return { info: `Added ${name}.` };
}

export async function updateOutletName(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!id || !name) return { error: "Name is required." };
  const supabase = await createClient();
  const { error } = await supabase.from("outlets").update({ name }).eq("id", id);
  if (error) return { error: error.message };
  invalidateMasters();
  revalidatePath("/admin/outlets");
  return { info: "Name updated." };
}

export async function toggleOutletActive(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const is_active = formData.get("is_active") === "true";
  const supabase = await createClient();
  await supabase.from("outlets").update({ is_active }).eq("id", id);
  invalidateMasters();
  revalidatePath("/admin/outlets");
}

export async function deleteOutlet(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing outlet id." };
  const supabase = await createClient();
  const admin = createAdminClient();

  // Check for any request_outlets rows referencing this outlet.
  const { count } = await admin
    .from("request_outlets")
    .select("request_id", { count: "exact", head: true })
    .eq("outlet_id", id);
  if ((count ?? 0) > 0) {
    return {
      error: `Cannot delete — ${count} payment request${count === 1 ? " uses" : "s use"} this outlet. Deactivate it instead so it won't show up in new requests.`,
    };
  }

  const { error } = await supabase.from("outlets").delete().eq("id", id);
  if (error) return { error: error.message };
  invalidateMasters();
  revalidatePath("/admin/outlets");
  revalidatePath("/admin");
  return { info: "Deleted." };
}

// ---------------------------------------------------------------------------
// COA heads
// ---------------------------------------------------------------------------

export async function createCoaHead(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const code = String(formData.get("code") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  if (!code || !name) return { error: "Code and name are required." };
  const supabase = await createClient();
  const { error } = await supabase.from("coa_heads").insert({ code, name });
  if (error) return { error: error.message };
  invalidateMasters();
  revalidatePath("/admin/coa");
  revalidatePath("/admin");
  return { info: `Added ${name}.` };
}

export async function toggleCoaActive(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const is_active = formData.get("is_active") === "true";
  const supabase = await createClient();
  await supabase.from("coa_heads").update({ is_active }).eq("id", id);
  invalidateMasters();
  revalidatePath("/admin/coa");
}

// ---------------------------------------------------------------------------
// Categories + Subcategories
// ---------------------------------------------------------------------------

export async function createCategory(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Name is required." };
  const supabase = await createClient();
  const { error } = await supabase.from("expense_categories").insert({ name });
  if (error) return { error: error.message };
  invalidateMasters();
  revalidatePath("/admin/categories");
  revalidatePath("/admin");
  return { info: `Added ${name}.` };
}

export async function createSubcategory(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const category_id = String(formData.get("category_id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const default_coa_head_id = String(formData.get("default_coa_head_id") ?? "");
  if (!category_id || !name || !default_coa_head_id) {
    return { error: "Category, name, and COA head are all required." };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("expense_subcategories")
    .insert({ category_id, name, default_coa_head_id });
  if (error) return { error: error.message };
  invalidateMasters();
  revalidatePath("/admin/categories");
  revalidatePath("/admin");
  return { info: `Added ${name}.` };
}

// ---------------------------------------------------------------------------
// Users + role assignment
// ---------------------------------------------------------------------------

const DOMAIN = "ristarafoods.com";
const VALID_ROLES = new Set(["requester", "approver", "accounts", "admin"]);

export async function createUser(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const emailLocal = String(formData.get("email_local") ?? "").trim().toLowerCase();
  const full_name = String(formData.get("full_name") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!emailLocal || !full_name || !password) {
    return { error: "Email, name, and password are all required." };
  }
  if (password.length < 8) return { error: "Password must be at least 8 characters." };
  const email = `${emailLocal}@${DOMAIN}`;

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name },
  });
  if (error) return { error: error.message };

  await admin.from("profiles").update({ full_name }).eq("id", data.user.id);

  revalidatePath("/admin/users");
  return { info: `Invited ${full_name} (${email}). Temp password: ${password}` };
}

export async function assignRole(formData: FormData): Promise<void> {
  const user_id = String(formData.get("user_id") ?? "");
  const role = String(formData.get("role") ?? "");
  if (!user_id || !VALID_ROLES.has(role)) return;
  const supabase = await createClient();
  await supabase.from("user_roles").upsert({ user_id, role });
  revalidatePath("/admin/users");
}

export async function removeRole(formData: FormData): Promise<void> {
  const user_id = String(formData.get("user_id") ?? "");
  const role = String(formData.get("role") ?? "");
  if (!user_id || !VALID_ROLES.has(role)) return;
  const supabase = await createClient();
  await supabase
    .from("user_roles")
    .delete()
    .eq("user_id", user_id)
    .eq("role", role);
  revalidatePath("/admin/users");
}
