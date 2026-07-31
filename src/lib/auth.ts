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
  if (!user) return { user: null, roles: [] as string[], isActive: true };

  const [{ data }, { data: profile }] = await Promise.all([
    supabase.from("user_roles").select("role").eq("user_id", user.id),
    supabase.from("profiles").select("is_active").eq("id", user.id).maybeSingle(),
  ]);

  // A profile row that hasn't appeared yet shouldn't lock anyone out, so the
  // default is active; only an explicit false counts as deactivated.
  const isActive = (profile as { is_active?: boolean } | null)?.is_active !== false;

  return {
    user,
    // Deactivation strips roles in the database too (migration 025); this
    // makes sure a stale row can't grant anything either.
    roles: isActive ? ((data ?? []) as Array<{ role: string }>).map((r) => r.role) : [],
    isActive,
  };
});

/** Returns the authenticated user or redirects to /login. */
export async function requireUser() {
  const { user, isActive } = await getAuthContext();
  if (!user) redirect("/login");
  // A deactivated account keeps a valid session until it expires, so the
  // check has to happen on every request rather than only at sign-in.
  if (!isActive) redirect("/deactivated");
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
