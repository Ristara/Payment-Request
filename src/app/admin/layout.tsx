import { redirect } from "next/navigation";
import AppShell from "@/components/AppShell";
import { getCurrentUserRoles, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * Admin section uses the same Zoho-style shell as the main app, but with:
 *  - a different set of sidebar icons (Users / Outlets / Categories / COA)
 *  - amber brand color to differentiate from the main indigo
 *  - a "Switch to My View" pill at the bottom to jump back to the requester side
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireUser();
  const { user, roles } = await getCurrentUserRoles();
  if (!roles.includes("admin")) redirect("/dashboard");

  const supabase = await createClient();
  const [profile, unread] = await Promise.all([
    user
      ? supabase.from("profiles").select("full_name, email").eq("id", user.id).single()
      : Promise.resolve({ data: null }),
    user
      ? supabase.from("notifications").select("*", { count: "exact", head: true }).eq("recipient_id", user.id).is("read_at", null)
      : Promise.resolve({ count: 0 }),
  ]);

  const links = [
    { href: "/admin", label: "Home", icon: <HomeIcon /> },
    { href: "/admin/users", label: "Users", icon: <UsersIcon /> },
    { href: "/admin/outlets", label: "Outlets", icon: <OutletsIcon /> },
    { href: "/admin/categories", label: "Categs", icon: <CategoriesIcon /> },
    { href: "/admin/coa", label: "COA", icon: <CoaIcon /> },
  ];

  const p = (profile as { data: { full_name?: string; email?: string } | null }).data;

  return (
    <AppShell
      links={links}
      variant="admin"
      brand="Ristara Foods · Admin"
      userName={p?.full_name}
      userEmail={p?.email}
      unreadCount={unread.count ?? 0}
      switchView={{
        href: "/dashboard",
        label: "Switch to My View",
        short: "My view",
        variant: "main",
      }}
    >
      {children}
    </AppShell>
  );
}

// --- Icons for the admin sidebar ---
const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

function HomeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" {...stroke}>
      <path d="M3 12l9-8 9 8" />
      <path d="M5 10v10h14V10" />
    </svg>
  );
}
function UsersIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" {...stroke}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" transform="translate(3 0)" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}
function OutletsIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" {...stroke}>
      <path d="M3 21h18M5 21V7l7-4 7 4v14M9 9h.01M9 12h.01M9 15h.01M15 9h.01M15 12h.01M15 15h.01" />
    </svg>
  );
}
function CategoriesIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" {...stroke}>
      <path d="M12 2l3 6 6 1-4.5 4.5 1 6-5.5-3-5.5 3 1-6L3 9l6-1 3-6z" />
    </svg>
  );
}
function CoaIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" {...stroke}>
      <path d="M4 4v16h16" />
      <path d="M4 20l6-6 4 4 6-10" />
    </svg>
  );
}
