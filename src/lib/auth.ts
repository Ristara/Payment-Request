import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Per-request memoized auth lookup. Layout + page both need the user and
 * roles; without cache() each call is a separate network round-trip to
 * Supabase Auth (getUser validates the JWT server-side). With cache()
 * the whole request shares one auth call and one roles query.
 */
const getAuthContext = cache(async () => {
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
});

/** Returns the authenticated user or redirects to /login. */
export async function requireUser() {
  const { user } = await getAuthContext();
  if (!user) redirect("/login");
  return user;
}

/** Returns { user, roles: string[] }. */
export async function getCurrentUserRoles() {
  return getAuthContext();
}

export function hasRole(roles: string[], role: string) {
  return roles.includes(role);
}

export function isStaff(roles: string[]) {
  return roles.some((r) => ["approver", "accounts", "admin"].includes(r));
}
