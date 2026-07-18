import AppShell from "@/components/AppShell";
import {
  HomeIcon,
  DocumentIcon,
  PlusCircleIcon,
  CheckSquareIcon,
  WalletIcon,
  VendorIcon,
  ChartIcon,
} from "@/components/SidebarIcons";
import { getCurrentUserRoles, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * Zoho-style shell wrapper. Any page that uses this gets the sidebar
 * + top bar automatically. Nav is computed from user's roles.
 */
export default async function AppLayoutShell({
  children,
  pageTitle,
}: {
  children: React.ReactNode;
  pageTitle?: string;
}) {
  await requireUser();
  const { user, roles } = await getCurrentUserRoles();
  const supabase = await createClient();

  const isAdmin = roles.includes("admin");
  const isApprover = roles.includes("approver");
  const isAccounts = roles.includes("accounts");
  const isStaff = isApprover || isAccounts || isAdmin;

  const [profile, unread, approvalBadge, accountsBadge, vendorBadge] = await Promise.all([
    user
      ? supabase.from("profiles").select("full_name, email").eq("id", user.id).single()
      : Promise.resolve({ data: null }),
    user
      ? supabase.from("notifications").select("*", { count: "exact", head: true }).eq("recipient_id", user.id).is("read_at", null)
      : Promise.resolve({ count: 0 }),
    isApprover
      ? supabase.from("request_installments").select("*", { count: "exact", head: true }).in("status", ["pending_approval", "clarification_required"])
      : Promise.resolve({ count: 0 }),
    isAccounts
      ? supabase.from("request_installments").select("*", { count: "exact", head: true }).in("status", ["approved", "uploaded_in_bank", "invoice_pending"])
      : Promise.resolve({ count: 0 }),
    isAccounts || isAdmin
      ? supabase.from("vendors").select("*", { count: "exact", head: true }).eq("status", "pending")
      : Promise.resolve({ count: 0 }),
  ]);

  const links = [
    { href: "/dashboard", label: "Home", icon: <HomeIcon /> },
    { href: "/requests", label: "Requests", icon: <DocumentIcon /> },
    { href: "/requests/new", label: "Raise", icon: <PlusCircleIcon /> },
    ...(isApprover ? [{ href: "/approvals", label: "Approve", icon: <CheckSquareIcon />, badge: approvalBadge.count ?? 0 }] : []),
    ...(isAccounts ? [{ href: "/accounts", label: "Accounts", icon: <WalletIcon />, badge: accountsBadge.count ?? 0 }] : []),
    ...(isAccounts || isAdmin ? [{ href: "/vendors", label: "Vendors", icon: <VendorIcon />, badge: vendorBadge.count ?? 0 }] : []),
    ...(isStaff ? [{ href: "/reports", label: "Reports", icon: <ChartIcon /> }] : []),
  ];

  const p = (profile as { data: { full_name?: string; email?: string } | null }).data;

  return (
    <AppShell
      links={links}
      showAdmin={isAdmin}
      userName={p?.full_name}
      userEmail={p?.email}
      unreadCount={unread.count ?? 0}
      pageTitle={pageTitle}
      switchView={isAdmin ? {
        href: "/admin",
        label: "Switch to Admin View",
        short: "Admin",
        variant: "admin",
      } : undefined}
    >
      {children}
    </AppShell>
  );
}
