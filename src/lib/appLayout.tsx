import AppHeader from "@/components/AppHeader";
import { getCurrentUserRoles, requireUser } from "@/lib/auth";

/**
 * Wrap page content with the standard app header + max-width main.
 * Nav links are computed from the user's roles.
 */
export default async function AppShell({ children }: { children: React.ReactNode }) {
  await requireUser();
  const { roles } = await getCurrentUserRoles();
  const isAdmin = roles.includes("admin");
  const isApprover = roles.includes("approver");
  const isAccounts = roles.includes("accounts");

  const isStaff = isApprover || isAccounts || isAdmin;
  const links = [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/requests", label: "My requests" },
    { href: "/requests/new", label: "Raise request" },
    ...(isApprover ? [{ href: "/approvals", label: "Approvals" }] : []),
    ...(isAccounts ? [{ href: "/accounts", label: "Accounts" }] : []),
    ...(isAccounts || isAdmin ? [{ href: "/vendors", label: "Vendors" }] : []),
    ...(isStaff ? [{ href: "/reports", label: "Reports" }] : []),
  ];

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <AppHeader links={links} showAdmin={isAdmin} />
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
