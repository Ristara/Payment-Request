"use server";

import { revalidatePath } from "next/cache";
import { COA_LABEL } from "@/lib/coa-labels";
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
  if (prof?.is_active === false) throw new Error("Your account is inactive.");
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
  // under its top level. That is every OpEx account, by design.
  const category = String(formData.get("category") ?? "").trim() || coa;
  // Which chart this belongs to — an account added on the OpEx tab that
  // landed in the CapEx chart would be invisible where it was created.
  const expense_type = String(formData.get("expense_type") ?? "") === "opex" ? "opex" : "capex";
  if (!subcategory || !coa) {
    return { error: `Name and ${COA_LABEL.level1.toLowerCase()} are both required.` };
  }
  if (subcategory === category) {
    return { error: `"${subcategory}" is already the name of its group — give the item its own name.` };
  }
  const supabase = await createClient();
  // code is auto-generated by the sequence.
  const { data, error } = await supabase
    .from("coa_accounts")
    .insert({ subcategory, category, coa, expense_type })
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
      return { error: `"${subcategory}" is the ${COA_LABEL.level2.toLowerCase()}'s own name — pick a different one.` };
    }
    const { data: sibling } = await supabase
      .from("coa_accounts")
      .select("id")
      .eq("coa", current.coa as string)
      .eq("category", subcategory)
      .limit(1)
      .maybeSingle();
    if (sibling) {
      return { error: `"${subcategory}" is already a ${COA_LABEL.level2.toLowerCase()} under ${current.coa} — pick a different name.` };
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
  return { info: `${COA_LABEL.level2} renamed.` };
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
  return { info: `${COA_LABEL.level1} renamed.` };
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
      ? `Account set to inactive and ${deleted} open request${deleted === 1 ? "" : "s"} deleted.`
      : "Account set to inactive. Their roles have been removed.",
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
  return { info: "Account set to active. Give them their roles again below." };
}

// ---------------------------------------------------------------------------
// Branch + expense-type access (governs raising only)
// ---------------------------------------------------------------------------

/**
 * Replace a person's branch grants wholesale.
 *
 * Wholesale rather than add/remove one at a time so the form submits what the
 * admin sees, and two admins editing at once can't merge into a set neither
 * of them chose.
 */
export async function setBranchAccess(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const denied = await adminDenied();
  if (denied) return { error: denied };

  const userId = String(formData.get("user_id") ?? "");
  if (!userId) return { error: "Missing user." };
  const outletIds = formData.getAll("outlet_ids").map(String).filter(Boolean);

  const admin = createAdminClient();
  await admin.from("user_branch_access").delete().eq("user_id", userId);
  if (outletIds.length > 0) {
    const { error } = await admin
      .from("user_branch_access")
      .insert(outletIds.map((outlet_id) => ({ user_id: userId, outlet_id })));
    if (error) return { error: error.message };
  }

  revalidatePath("/admin/users");
  return {
    info: outletIds.length
      ? `Can raise for ${outletIds.length} branch${outletIds.length === 1 ? "" : "es"}.`
      : "No branches — they can't raise anything until you assign one.",
  };
}

/** Same, for CapEx / OpEx. */
export async function setExpenseAccess(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const denied = await adminDenied();
  if (denied) return { error: denied };

  const userId = String(formData.get("user_id") ?? "");
  if (!userId) return { error: "Missing user." };
  const types = formData
    .getAll("expense_types")
    .map(String)
    .filter((t) => t === "capex" || t === "opex");

  const admin = createAdminClient();
  await admin.from("user_expense_access").delete().eq("user_id", userId);
  if (types.length > 0) {
    const { error } = await admin
      .from("user_expense_access")
      .insert(types.map((expense_type) => ({ user_id: userId, expense_type })));
    if (error) return { error: error.message };
  }

  revalidatePath("/admin/users");
  return {
    info: types.length ? `Can raise ${types.join(" and ")}.` : "No expense types — they can't raise.",
  };
}

// ---------------------------------------------------------------------------
// TDS sections
// ---------------------------------------------------------------------------

/** Shared parsing for create and update. */
function readTdsSection(formData: FormData) {
  const code = String(formData.get("code") ?? "").trim().toUpperCase();
  const name = String(formData.get("name") ?? "").trim();
  const rateRaw = String(formData.get("rate") ?? "").trim();
  // Blank is a real answer: a section with no rate is still choosable, and the
  // amount is typed by hand either way. It is not the same as zero.
  const rate = rateRaw === "" ? null : Number(rateRaw);
  if (!code) return { error: "Section code is required." as const };
  if (!name) return { error: "Description is required." as const };
  if (rate !== null && (!Number.isFinite(rate) || rate < 0 || rate > 100)) {
    return { error: "Rate must be between 0 and 100." as const };
  }
  const statutory_ref = String(formData.get("statutory_ref") ?? "").trim() || null;
  return { code, name, rate, statutory_ref };
}

export async function createTdsSection(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const denied = await adminDenied();
  if (denied) return { error: denied };
  const parsed = readTdsSection(formData);
  if ("error" in parsed) return { error: parsed.error };

  const admin = createAdminClient();
  const { error } = await admin.from("tds_sections").insert(parsed);
  if (error) {
    return {
      error: error.code === "23505" ? `${parsed.code} is already in the list.` : error.message,
    };
  }
  invalidateMasters();
  revalidatePath("/admin/tds");
  return { info: `${parsed.code} added.` };
}

export async function updateTdsSection(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const denied = await adminDenied();
  if (denied) return { error: denied };
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing section." };
  const parsed = readTdsSection(formData);
  if ("error" in parsed) return { error: parsed.error };

  const admin = createAdminClient();
  const { error } = await admin
    .from("tds_sections")
    .update({ ...parsed, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) {
    return {
      error: error.code === "23505" ? `${parsed.code} is already in the list.` : error.message,
    };
  }
  invalidateMasters();
  revalidatePath("/admin/tds");
  return { info: `${parsed.code} saved.` };
}

export async function setTdsSectionActive(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const denied = await adminDenied();
  if (denied) return { error: denied };
  const id = String(formData.get("id") ?? "");
  const active = String(formData.get("is_active") ?? "") === "true";
  if (!id) return { error: "Missing section." };

  const admin = createAdminClient();
  const { error } = await admin
    .from("tds_sections")
    .update({ is_active: active, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };
  invalidateMasters();
  revalidatePath("/admin/tds");
  return { info: active ? "Back in the list." : "Hidden from Accounts." };
}

/**
 * Deletes a section, but only one nobody has used.
 *
 * A section attached to a deduction is part of a tax record. The foreign key
 * would null itself out quietly and the installment would keep a section name
 * pointing at nothing. Turning it off is the right move there, so that is what
 * the error says.
 */
export async function deleteTdsSection(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const denied = await adminDenied();
  if (denied) return { error: denied };
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing section." };

  const admin = createAdminClient();
  const { count } = await admin
    .from("request_installments")
    .select("id", { count: "exact", head: true })
    .eq("tds_section_id", id);
  if ((count ?? 0) > 0) {
    return {
      error: `Used on ${count} deduction${count === 1 ? "" : "s"} — turn it off instead so the record stays intact.`,
    };
  }

  const { error } = await admin.from("tds_sections").delete().eq("id", id);
  if (error) return { error: error.message };
  invalidateMasters();
  revalidatePath("/admin/tds");
  return { info: "Removed." };
}

// ---------------------------------------------------------------------------
// Vendors
// ---------------------------------------------------------------------------

/**
 * Delete a vendor outright — admin only.
 *
 * For clearing out junk: duplicates, typos, test rows, someone added twice.
 * NOT a way to retire a vendor you have actually paid. A vendor carrying
 * payment requests is refused, because deleting it would mean deleting the
 * payments too; the FK is ON DELETE RESTRICT so the database would refuse
 * anyway, and this turns that into a sentence rather than a constraint error.
 *
 * Procurement requests are refused for a different reason: that FK is
 * ON DELETE SET NULL, so the delete would quietly succeed and leave a
 * procurement request whose PO vendor had silently become blank.
 */
export async function deleteVendor(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const denied = await adminDenied();
  if (denied) return { error: denied };
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing vendor." };

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("vendors")
    .select("name, cancelled_cheque_path")
    .eq("id", id)
    .maybeSingle();
  if (!row) return { error: "Vendor not found — it may already be deleted." };
  const vendor = row as { name: string; cancelled_cheque_path: string | null };

  const [{ count: reqCount }, { count: procCount }] = await Promise.all([
    admin.from("payment_requests").select("id", { count: "exact", head: true }).eq("vendor_id", id),
    admin
      .from("procurement_requests")
      .select("id", { count: "exact", head: true })
      .eq("po_vendor_id", id),
  ]);
  if ((reqCount ?? 0) > 0) {
    return {
      error: `${vendor.name} is on ${reqCount} payment request${
        reqCount === 1 ? "" : "s"
      } — deleting it would take that payment history with it. Reject the vendor instead.`,
    };
  }
  if ((procCount ?? 0) > 0) {
    return {
      error: `${vendor.name} is the PO vendor on ${procCount} procurement request${
        procCount === 1 ? "" : "s"
      }. Change those first, or they'd be left with no vendor.`,
    };
  }

  // Read the file paths BEFORE the delete: the attachment rows cascade away
  // with the vendor, and once they are gone nothing points at the files.
  const { data: atts } = await admin
    .from("attachments")
    .select("storage_path")
    .eq("vendor_id", id);
  const paths = [
    ...((atts ?? []) as { storage_path: string }[]).map((a) => a.storage_path),
    ...(vendor.cancelled_cheque_path ? [vendor.cancelled_cheque_path] : []),
  ].filter(Boolean);

  // Row first, files second. The other way round, a delete that then failed
  // would leave the vendor in place with its documents already destroyed.
  const { error } = await admin.from("vendors").delete().eq("id", id);
  if (error) {
    return error.code === "23503"
      ? { error: `${vendor.name} is still referenced somewhere, so it can't be deleted.` }
      : { error: error.message };
  }

  const unique = [...new Set(paths)];
  let orphaned = false;
  if (unique.length > 0) {
    const { error: rmErr } = await admin.storage.from("vendor-docs").remove(unique);
    orphaned = !!rmErr;
  }

  invalidateMasters();
  revalidatePath("/vendors");
  return {
    info: orphaned
      ? `${vendor.name} deleted, but its files couldn't be removed from storage.`
      : `${vendor.name} deleted.`,
  };
}

/**
 * Set a user's password — admin only.
 *
 * The admin already chooses the password when inviting someone, so this is the
 * same power applied to an account that already exists: someone locked out,
 * or a password that needs changing after a person leaves.
 *
 * Two things it deliberately does not do. It never echoes the password back —
 * a value returned into the page ends up in screenshots, scrollback and
 * browser history. And it never reads the existing one, because it cannot:
 * Supabase stores a hash, and "reset" is the only operation available.
 *
 * It is logged. Whoever can do this can take over any account in the system,
 * including another admin's, so the record of who did it to whom is the part
 * that makes it accountable rather than invisible.
 */
export async function setUserPassword(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  // requireAdmin rather than adminDenied: this needs the actor's id for the
  // audit row as well as the gate, and calling both would check twice.
  let actor: { id: string };
  try {
    ({ user: actor } = await requireAdmin());
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Not allowed." };
  }

  const userId = String(formData.get("user_id") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (!userId) return { error: "Missing user." };
  if (password.length < 8) return { error: "Password must be at least 8 characters." };
  if (password !== confirm) return { error: "The two passwords don't match." };

  const admin = createAdminClient();

  const { data: target } = await admin
    .from("profiles")
    .select("full_name, email")
    .eq("id", userId)
    .maybeSingle();
  const person = target as { full_name: string | null; email: string | null } | null;
  if (!person) return { error: "That user no longer exists." };

  const { error } = await admin.auth.admin.updateUserById(userId, { password });
  if (error) return { error: error.message };

  // The password itself is never written here — only who reset whose, and when.
  await admin.from("audit_log").insert({
    actor_id: actor.id,
    action: "password_reset",
    field_name: "password",
    new_value: person.email ?? userId,
    reason:
      userId === actor.id ? "Admin reset their own password" : "Admin reset another user's password",
  });

  revalidatePath("/admin/users");
  return {
    info: `Password set for ${person.full_name ?? person.email}. Tell them directly — it isn't emailed.`,
  };
}

/**
 * Which raise paths a person may use — "Pay a vendor", "Buy or repair".
 *
 * Same shape as setExpenseAccess: replace the whole set rather than toggling
 * one row, so the saved state is exactly what the admin ticked and there is no
 * way to end up half-applied.
 */
export async function setModuleAccess(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const denied = await adminDenied();
  if (denied) return { error: denied };

  const userId = String(formData.get("user_id") ?? "");
  if (!userId) return { error: "Missing user." };
  const modules = formData
    .getAll("modules")
    .map(String)
    .filter((m) => m === "payment" || m === "procurement");

  const admin = createAdminClient();
  await admin.from("user_module_access").delete().eq("user_id", userId);
  if (modules.length > 0) {
    const { error } = await admin
      .from("user_module_access")
      .insert(modules.map((module) => ({ user_id: userId, module })));
    if (error) return { error: error.message };
  }

  invalidateMasters();
  revalidatePath("/admin/users");
  const names = modules.map((m) => (m === "payment" ? "Pay a vendor" : "Buy or repair"));
  return {
    info: names.length ? `Can use ${names.join(" and ")}.` : "No raise paths — they can't raise at all.",
  };
}
