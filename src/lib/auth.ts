import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/types";

/** Returns the authenticated user or redirects to /login. */
export async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return user;
}

/** Returns { user, roles: string[] }. Redirects if not signed in. */
export async function getCurrentUserRoles() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { user: null, roles: [] as string[] };

  const { data } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id);

  return {
    user,
    roles: ((data ?? []) as Array<{ role: string }>).map((r) => r.role),
  };
}

export function hasRole(roles: string[], role: string) {
  return roles.includes(role);
}

export function isStaff(roles: string[]) {
  return roles.some((r) => ["approver", "accounts", "admin"].includes(r));
}
