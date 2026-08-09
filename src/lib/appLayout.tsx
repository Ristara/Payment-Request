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
import { hasUnrestrictedRaise } from "@/lib/access-labels";

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
  // Raising needs the requester role AND somewhere to raise for. A tab that
  // can only say no isn't worth a slot in the nav.
  const hasRaiseRole = roles.includes("requester") || isAdmin;
  // Admin, approver and accounts raise for any branch, so there is nothing to
  // count for them — and counting would wrongly hide the Raise tab from an
  // approver who has never been granted a branch.
  const unrestrictedRaise = hasUnrestrictedRaise(roles);
  const grants = hasRaiseRole && !unrestrictedRaise
    ? await Promise.all([
        supabase.from("user_branch_access").select("outlet_id", { count: "exact", head: true }).eq("user_id", user!.id),
        supabase.from("user_expense_access").select("expense_type", { count: "exact", head: true }).eq("user_id", user!.id),
      ])
    : null;
  const canRaise =
    hasRaiseRole &&
    (unrestrictedRaise || ((grants?.[0].count ?? 0) > 0 && (grants?.[1].count ?? 0) > 0));

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
    ...(canRaise ? [{ href: "/requests/new", label: "Raise payment request", icon: <PlusCircleIcon /> }] : []),
    ...(isApprover ? [{ href: "/approvals", label: "Approve", icon: <CheckSquareIcon />, badge: approvalBadge.count ?? 0 }] : []),
    ...(isAccounts ? [{ href: "/accounts", label: "Accounts", icon: <WalletIcon />, badge: accountsBadge.count ?? 0 }] : []),
    // Requesters need to look vendors up and add new ones; the pending-vendor
    // badge is an Accounts to-do, so it stays with Accounts.
    ...(canRaise || isStaff
      ? [{
          href: "/vendors",
          label: "Vendors",
          icon: <VendorIcon />,
          ...(isAccounts || isAdmin ? { badge: vendorBadge.count ?? 0 } : {}),
        }]
      : []),
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
