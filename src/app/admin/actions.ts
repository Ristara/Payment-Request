"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { invalidateMasters } from "@/lib/cache";
import { getOpenRequestsFor, purgeRequest } from "@/lib/purge-request";

export type ActionState = { error?: string; info?: string } | undefined;

/**
 * Every action in this file is admin-only.
 *
 * The /admin layout already redirects non-admins, but a layout only guards
 * rendering: a server action is dispatched by ID and can be POSTed to any
 * route, so the layout never runs for it. Several of these actions reach for
 * the service-role client, where RLS is not a backstop either — so the check
 * has to live here.
 */
async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  const [{ data: roleRows }, { data: profile }] = await Promise.all([
    supabase.from("user_roles").select("role").eq("user_id", user.id),
    supabase.from("profiles").select("email, is_active").eq("id", user.id).maybeSingle(),
  ]);
  const prof = profile as { email?: string; is_active?: boolean } | null;
  if (prof?.is_active === false) throw new Error("Your access has been turned off.");
  const roles = new Set(((roleRows ?? []) as { role: string }[]).map((r) => r.role));
  if (!roles.has("admin")) throw new Error("You don't have permission to do that.");
  return { supabase, user, email: prof?.email ?? null };
}

/** Same gate, for actions that report failure rather than throw. */
async function adminDenied(): Promise<string | null> {
  try {
    await requireAdmin();
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "Not allowed.";
  }
}

// ---------------------------------------------------------------------------
// Outlets
// ---------------------------------------------------------------------------

export async function createOutlet(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const denied = await adminDenied();
  if (denied) return { error: denied };
  const code = String(formData.get("code") ?? "").trim().toUpperCase();
  const name = String(formData.get("name") ?? "").trim();
  const stageRaw = String(formData.get("stage") ?? "operational");
  const stage = stageRaw === "upcoming" ? "upcoming" : "operational";
  if (!code || !name) return { error: "Code and name are required." };

  const supabase = await createClient();
  const { error } = await supabase.from("outlets").insert({ code, name, stage });
  if (error) return { error: error.message };

  invalidateMasters();
  revalidatePath("/admin/outlets");
  revalidatePath("/admin");
  return { info: `Added ${name}.` };
}

export async function setOutletStage(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const stageRaw = String(formData.get("stage") ?? "");
  if (!id || !["upcoming", "operational"].includes(stageRaw)) return;
  const supabase = await createClient();
  await supabase.from("outlets").update({ stage: stageRaw }).eq("id", id);
  invalidateMasters();
  revalidatePath("/admin/outlets");
}

export async function updateOutletName(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const denied = await adminDenied();
  if (denied) return { error: denied };
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
  await requireAdmin();
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
  const denied = await adminDenied();
  if (denied) return { error: denied };
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
// COA accounts (unified Chart of Accounts)
// ---------------------------------------------------------------------------

export async function createCoaAccount(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const denied = await adminDenied();
  if (denied) return { error: denied };
  const subcategory = String(formData.get("subcategory") ?? "").trim();
  const coa = String(formData.get("coa") ?? "").trim();
  // Two-level UI: when no intermediate group is given, the item sits directly
  // under its COA head.
  const category = String(formData.get("category") ?? "").trim() || coa;
  if (!subcategory || !coa) {
    return { error: "Name and COA head are both required." };
  }
  if (subcategory === category) {
    return { error: `"${subcategory}" is already the name of its group — give the item its own name.` };
  }
  const supabase = await createClient();
  // code is auto-generated by the sequence.
  const { data, error } = await supabase
    .from("coa_accounts")
    .insert({ subcategory, category, coa })
    .select("code")
    .single();
  if (error) {
    if (error.code === "23505") return { error: `"${subcategory}" already exists under ${coa}.` };
    return { error: error.message };
  }
  invalidateMasters();
  revalidatePath("/admin/coa");
  revalidatePath("/admin");
  return { info: `Added ${subcategory} (code ${data?.code}).` };
}

export async function updateCoaAccount(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const denied = await adminDenied();
  if (denied) return { error: denied };
  const id = String(formData.get("id") ?? "");
  const subcategory = String(formData.get("subcategory") ?? "").trim();
  const category = String(formData.get("category") ?? "").trim();
  const coa = String(formData.get("coa") ?? "").trim();
  if (!id || !subcategory || !category || !coa) {
    return { error: "All fields are required." };
  }
  // Guard the same invariants createCoaAccount enforces: a leaf must not
  // take its own category's name (that row is the category anchor, hidden
  // from the tree) nor a sibling category's name (computeRollupIds would
  // treat it as a group and hide it).
  const supabase = await createClient();
  const { data: current } = await supabase
    .from("coa_accounts")
    .select("coa, category")
    .eq("id", id)
    .maybeSingle();
  if (current) {
    if (subcategory === (current.category as string)) {
      return { error: `"${subcategory}" is the category's own name — pick a different one.` };
    }
    const { data: sibling } = await supabase
      .from("coa_accounts")
      .select("id")
      .eq("coa", current.coa as string)
      .eq("category", subcategory)
      .limit(1)
      .maybeSingle();
    if (sibling) {
      return { error: `"${subcategory}" is already a category under ${current.coa} — pick a different name.` };
    }
  }
  const { error } = await supabase
    .from("coa_accounts")
    .update({ subcategory, category, coa })
    .eq("id", id);
  if (error) return { error: error.message };
  invalidateMasters();
  revalidatePath("/admin/coa");
  return { info: "Updated." };
}

export async function toggleCoaAccountActive(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const is_active = formData.get("is_active") === "true";
  const supabase = await createClient();
  await supabase.from("coa_accounts").update({ is_active }).eq("id", id);
  invalidateMasters();
  revalidatePath("/admin/coa");
}

export async function deleteCoaAccount(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const denied = await adminDenied();
  if (denied) return { error: denied };
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing account id." };
  const supabase = await createClient();
  const admin = createAdminClient();

  // Block delete if any request line items reference this account.
  const { count } = await admin
    .from("request_line_items")
    .select("id", { count: "exact", head: true })
    .eq("coa_account_id", id);
  if ((count ?? 0) > 0) {
    return {
      error: `Cannot delete — ${count} line item${count === 1 ? " uses" : "s use"} this account. Deactivate it instead.`,
    };
  }

  const { error } = await supabase.from("coa_accounts").delete().eq("id", id);
  if (error) return { error: error.message };
  invalidateMasters();
  revalidatePath("/admin/coa");
  return { info: "Deleted." };
}

/**
 * Rename an entire Category group: updates every coa_accounts row where
 * (coa, category) matches the old pair, setting category to the new name.
 * Fails if the new name is already used under the same COA head (would
 * merge two categories, which is a separate operation we don't expose yet).
 */
export async function renameCategoryGroup(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const denied = await adminDenied();
  if (denied) return { error: denied };
  const coa = String(formData.get("coa") ?? "").trim();
  const oldCategory = String(formData.get("old_category") ?? "").trim();
  const newCategory = String(formData.get("new_category") ?? "").trim();
  if (!coa || !oldCategory || !newCategory) return { error: "All fields required." };
  if (oldCategory === newCategory) return { info: "No change." };

  const supabase = await createClient();
  const admin = createAdminClient();

  const { count: clash } = await admin
    .from("coa_accounts")
    .select("id", { count: "exact", head: true })
    .eq("coa", coa)
    .eq("category", newCategory);
  if ((clash ?? 0) > 0) {
    return { error: `A category named "${newCategory}" already exists under ${coa}.` };
  }
  // A subcategory sharing the new name would be read as a group row by
  // computeRollupIds and vanish from the tree — block it up front.
  const { count: subClash } = await admin
    .from("coa_accounts")
    .select("id", { count: "exact", head: true })
    .eq("coa", coa)
    .eq("subcategory", newCategory)
    .neq("category", oldCategory);
  if ((subClash ?? 0) > 0) {
    return { error: `A subcategory under ${coa} is already called "${newCategory}" — pick another name.` };
  }

  const { error } = await supabase
    .from("coa_accounts")
    .update({ category: newCategory })
    .eq("coa", coa)
    .eq("category", oldCategory);
  if (error) return { error: error.message };
  // Rows NAMED after the category — self-named anchors and rollup knit rows
  // under a parent — must follow the rename, or category-level charging and
  // the tree linkage break for the new name. In this name-knit model, ANY row
  // in the COA head bearing the category's name IS part of its linkage
  // (computeRollupIds flags it), so renaming all of them is the consistent
  // behavior.
  const { error: subErr } = await supabase
    .from("coa_accounts")
    .update({ subcategory: newCategory })
    .eq("coa", coa)
    .eq("subcategory", oldCategory);
  if (subErr) return { error: subErr.message };
  invalidateMasters();
  revalidatePath("/admin/coa");
  return { info: "Category renamed." };
}

/**
 * Rename an entire COA head: updates every coa_accounts row where coa
 * matches. Fails if a row with the new name already exists (would merge).
 */
export async function renameCoaGroup(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const denied = await adminDenied();
  if (denied) return { error: denied };
  const oldCoa = String(formData.get("old_coa") ?? "").trim();
  const newCoa = String(formData.get("new_coa") ?? "").trim();
  if (!oldCoa || !newCoa) return { error: "Both names required." };
  if (oldCoa === newCoa) return { info: "No change." };

  const supabase = await createClient();
  const admin = createAdminClient();

  const { count: clash } = await admin
    .from("coa_accounts")
    .select("id", { count: "exact", head: true })
    .eq("coa", newCoa);
  if ((clash ?? 0) > 0) {
    return { error: `A COA head named "${newCoa}" already exists.` };
  }

  const { error } = await supabase
    .from("coa_accounts")
    .update({ coa: newCoa })
    .eq("coa", oldCoa);
  if (error) return { error: error.message };
  invalidateMasters();
  revalidatePath("/admin/coa");
  return { info: "COA head renamed." };
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
  const denied = await adminDenied();
  if (denied) return { error: denied };
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
  // Don't echo the password back — it ends up in logs, screenshots and
  // browser history. The admin just typed it.
  return { info: `Invited ${full_name} (${email}).` };
}

export async function assignRole(formData: FormData): Promise<void> {
  await requireAdmin();
  const user_id = String(formData.get("user_id") ?? "");
  const role = String(formData.get("role") ?? "");
  if (!user_id || !VALID_ROLES.has(role)) return;
  const supabase = await createClient();
  await supabase.from("user_roles").upsert({ user_id, role });
  revalidatePath("/admin/users");
}

export async function removeRole(formData: FormData): Promise<void> {
  await requireAdmin();
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

// ---------------------------------------------------------------------------
// Deactivation
// ---------------------------------------------------------------------------

/** Requests from this person that are still in flight, for the confirmation. */
export async function listOpenRequestsForUser(userId: string) {
  await requireAdmin();
  return getOpenRequestsFor(createAdminClient(), userId);
}

/**
 * Turn an account off.
 *
 * Roles are stripped by a database trigger (migration 025) rather than here,
 * so the two can't drift apart. Optionally deletes the requests the person
 * left in flight — a departing requester's half-finished submissions would
 * otherwise sit in the approvers' queue with nobody able to answer questions
 * about them.
 */
export async function deactivateUser(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const userId = String(formData.get("user_id") ?? "");
  const deleteOpen = formData.get("delete_open") === "true";
  const reason = String(formData.get("reason") ?? "").trim() || null;
  if (!userId) return { error: "Missing user." };

  let actor;
  try {
    actor = await requireAdmin();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Not allowed." };
  }
  // Locking yourself out of your own admin console is never the intent.
  if (userId === actor.user.id) {
    return { error: "You can't deactivate your own account. Ask another admin." };
  }

  const admin = createAdminClient();
  let deleted = 0;

  if (deleteOpen) {
    const open = await getOpenRequestsFor(admin, userId);
    for (const r of open) {
      const err = await purgeRequest(
        admin,
        r.id,
        { id: actor.user.id, email: actor.email },
        reason ? `${reason} (user deactivated)` : "Submitter deactivated",
      );
      // Stop rather than half-finish: the admin can retry knowing what's left.
      if (err) return { error: `Stopped after ${deleted} deleted — ${r.requestNumber}: ${err}` };
      deleted++;
    }
  }

  const { error } = await admin.from("profiles").update({ is_active: false }).eq("id", userId);
  if (error) return { error: error.message };

  revalidatePath("/admin/users");
  revalidatePath("/requests");
  revalidatePath("/approvals");
  revalidatePath("/accounts");
  return {
    info: deleted
      ? `Account turned off and ${deleted} open request${deleted === 1 ? "" : "s"} deleted.`
      : "Account turned off. Their roles have been removed.",
  };
}

/** Turn an account back on. Roles were stripped on deactivation, so they need re-granting. */
export async function reactivateUser(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const userId = String(formData.get("user_id") ?? "");
  if (!userId) return { error: "Missing user." };
  try {
    await requireAdmin();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Not allowed." };
  }
  const { error } = await createAdminClient()
    .from("profiles")
    .update({ is_active: true })
    .eq("id", userId);
  if (error) return { error: error.message };
  revalidatePath("/admin/users");
  return { info: "Account turned back on. Give them their roles again below." };
}
