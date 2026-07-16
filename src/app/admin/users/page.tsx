import { createClient } from "@/lib/supabase/server";
import UsersForm from "./users-form";

type UserRow = {
  id: string;
  email: string;
  full_name: string;
  is_active: boolean;
  user_roles: { role: string }[];
};

export default async function UsersPage() {
  const supabase = await createClient();
  const { data: users } = await supabase
    .from("profiles")
    .select("id, email, full_name, is_active, user_roles(role)")
    .order("full_name");

  return (
    <div>
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Users &amp; roles</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Invite people from your team and give them the roles they need. Email domain is locked to ristarafoods.com.
      </p>

      <div className="mt-8">
        <UsersForm users={(users ?? []) as unknown as UserRow[]} />
      </div>
    </div>
  );
}
