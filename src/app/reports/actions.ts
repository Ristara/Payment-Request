"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type ReportState = { error?: string; info?: string } | undefined;

/** The shape of a saved pivot. Kept loose on purpose — see migration 053. */
export type ReportConfig = {
  rows: string[];
  cols: string[];
  filters: string[];
  excluded: Record<string, string[]>;
  from?: string;
  to?: string;
};

/**
 * Save the current layout under a name.
 *
 * Everything goes through the user's own client, so RLS decides ownership
 * rather than a user_id read off the form — a value from a form is a value
 * the sender chose, and saving into someone else's list should not be one
 * hidden field away.
 *
 * Saving under a name you already used overwrites it. That is the behaviour
 * people expect from Save, and the alternative — a silent second copy of
 * "Monthly spend" — is worse than losing the older layout.
 */
export async function saveReport(_prev: ReportState, formData: FormData): Promise<ReportState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Give the report a name." };
  if (name.length > 80) return { error: "That name is too long." };

  let config: ReportConfig;
  try {
    config = JSON.parse(String(formData.get("config") ?? ""));
  } catch {
    return { error: "Couldn't read the layout. Refresh and try again." };
  }
  if (!config || typeof config !== "object" || !Array.isArray(config.rows)) {
    return { error: "Couldn't read the layout. Refresh and try again." };
  }
  if (config.rows.length === 0 && config.cols.length === 0) {
    return { error: "Put at least one field on rows or columns before saving." };
  }

  const { error } = await supabase
    .from("saved_reports")
    .upsert(
      { owner_id: user.id, name, config, updated_at: new Date().toISOString() },
      { onConflict: "owner_id,name" },
    );
  if (error) return { error: error.message };

  revalidatePath("/reports");
  return { info: `Saved as "${name}".` };
}

export async function deleteReport(_prev: ReportState, formData: FormData): Promise<ReportState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing report." };

  // No owner check here: the policy is the check, and it cannot be talked out
  // of it by a crafted id the way a forgotten `if` can.
  const { error } = await supabase.from("saved_reports").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/reports");
  return { info: "Removed." };
}
