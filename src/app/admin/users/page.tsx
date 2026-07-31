import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUserRoles } from "@/lib/auth";
import { getOpenRequestsFor } from "@/lib/purge-request";
import UsersForm, { type OpenRequest } from "./users-form";

type UserRow = {
  id: string;
  email: string;
  full_name: string;
  is_active: boolean;
  user_roles: { role: string }[];
};

export default async function UsersPage() {
  const supabase = await createClient();
  const [{ data: users }, { user: me }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, email, full_name, is_active, user_roles(role)")
      .order("full_name"),
    getCurrentUserRoles(),
  ]);

  const rows = (users ?? []) as unknown as UserRow[];

  // Loaded up front so the deactivation panel can list exactly what would be
  // deleted, instead of making the admin go and look it up somewhere else.
  const admin = createAdminClient();
  const openLists = await Promise.all(
    rows.map((u) => (u.is_active ? getOpenRequestsFor(admin, u.id) : Promise.resolve([]))),
  );
  const openByUser: Record<string, OpenRequest[]> = {};
  rows.forEach((u, i) => {
    openByUser[u.id] = openLists[i];
  });

  return (
    <div>
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Users &amp; roles</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Invite people from your team and give them the roles they need. Email domain is locked to ristarafoods.com.
      </p>

      <div className="mt-8">
        <UsersForm users={rows} openByUser={openByUser} currentUserId={me?.id ?? ""} />
      </div>
    </div>
  );
}
