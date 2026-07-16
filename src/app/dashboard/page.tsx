import Link from "next/link";
import AppHeader from "@/components/AppHeader";
import { getCurrentUserRoles, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ROLE_LABEL, STATUS_LABEL, formatINR } from "@/lib/types";

type RecentRow = {
  id: string;
  request_number: string;
  status: string;
  payment_amount: number;
  vendor: { name: string } | null;
};

export default async function DashboardPage() {
  const user = await requireUser();
  const { roles } = await getCurrentUserRoles();
  const supabase = await createClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, email")
    .eq("id", user.id)
    .single();

  const isAdmin = roles.includes("admin");
  const isApprover = roles.includes("approver");
  const isAccounts = roles.includes("accounts");

  // Parallel counters
  const [myCount, approveCount, accountsCount, vendorPending, unread] = await Promise.all([
    supabase.from("payment_requests").select("*", { count: "exact", head: true }).eq("submitter_id", user.id),
    isApprover
      ? supabase.from("payment_requests").select("*", { count: "exact", head: true }).in("status", ["pending_approval", "clarification_required"])
      : Promise.resolve({ count: 0 }),
    isAccounts
      ? supabase.from("payment_requests").select("*", { count: "exact", head: true }).in("status", ["approved", "uploaded_in_bank", "invoice_pending"])
      : Promise.resolve({ count: 0 }),
    isAccounts || isAdmin
      ? supabase.from("vendors").select("*", { count: "exact", head: true }).eq("status", "pending")
      : Promise.resolve({ count: 0 }),
    supabase.from("notifications").select("*", { count: "exact", head: true }).eq("recipient_id", user.id).is("read_at", null),
  ]);

  const { data: recent } = await supabase
    .from("payment_requests")
    .select("id, request_number, status, payment_amount, vendor:vendors(name)")
    .eq("submitter_id", user.id)
    .order("created_at", { ascending: false })
    .limit(5);

  const links = [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/requests", label: "My requests" },
    { href: "/requests/new", label: "Raise request" },
    ...(isApprover ? [{ href: "/approvals", label: "Approvals" }] : []),
    ...(isAccounts ? [{ href: "/accounts", label: "Accounts" }] : []),
    ...(isAccounts || isAdmin ? [{ href: "/vendors", label: "Vendors" }] : []),
    { href: "/notifications", label: `Inbox${(unread.count ?? 0) > 0 ? ` (${unread.count})` : ""}` },
  ];

  const tiles: { href: string; label: string; count: number; hint: string; tone: string }[] = [
    {
      href: "/requests/new",
      label: "Raise a request",
      count: 0,
      hint: "Vendor payment",
      tone: "bg-white",
    },
    { href: "/requests", label: "My requests", count: myCount.count ?? 0, hint: "you raised", tone: "bg-white" },
  ];
  if (isApprover) {
    tiles.push({
      href: "/approvals",
      label: "Waiting on you",
      count: approveCount.count ?? 0,
      hint: "to approve",
      tone: (approveCount.count ?? 0) > 0 ? "bg-amber-50 border-amber-200" : "bg-white",
    });
  }
  if (isAccounts) {
    tiles.push({
      href: "/accounts",
      label: "Accounts queue",
      count: accountsCount.count ?? 0,
      hint: "to process",
      tone: (accountsCount.count ?? 0) > 0 ? "bg-sky-50 border-sky-200" : "bg-white",
    });
    tiles.push({
      href: "/vendors?status=pending",
      label: "New vendors",
      count: vendorPending.count ?? 0,
      hint: "to verify",
      tone: (vendorPending.count ?? 0) > 0 ? "bg-orange-50 border-orange-200" : "bg-white",
    });
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <AppHeader links={links} showAdmin={isAdmin} userName={profile?.full_name} />
      <main className="mx-auto max-w-5xl px-6 py-8">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          Welcome, {profile?.full_name?.split(" ")[0] ?? user.email}
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Roles:{" "}
          {roles.length === 0 ? (
            <span className="text-amber-700 dark:text-amber-300">none assigned yet</span>
          ) : (
            roles.map((r) => ROLE_LABEL[r] ?? r).join(" · ")
          )}
        </p>

        <section className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {tiles.map((t) => (
            <Link
              key={t.label}
              href={t.href}
              className={`rounded-2xl border border-zinc-200 p-5 hover:border-indigo-400 dark:border-zinc-800 dark:hover:border-indigo-700 ${t.tone.startsWith("bg-white") ? "dark:bg-zinc-900 bg-white" : t.tone}`}
            >
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                {t.label}
              </p>
              {t.count > 0 || t.label === "Raise a request" ? (
                <p className="mt-2 text-3xl font-semibold text-zinc-900 dark:text-zinc-50 tabular-nums">
                  {t.label === "Raise a request" ? "+" : t.count}
                </p>
              ) : (
                <p className="mt-2 text-sm text-zinc-500">0 — clear</p>
              )}
              <p className="mt-1 text-xs text-zinc-500">{t.hint}</p>
            </Link>
          ))}
        </section>

        {recent && recent.length > 0 && (
          <section className="mt-8 rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-200 dark:border-zinc-800">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Your recent requests
              </h2>
              <Link href="/requests" className="text-xs text-indigo-600 hover:underline dark:text-indigo-400">
                See all →
              </Link>
            </div>
            <ul>
              {(recent as unknown as RecentRow[]).map((r) => (
                <li key={r.id} className="border-b border-zinc-100 last:border-b-0 dark:border-zinc-800">
                  <Link href={`/requests/${r.id}`} className="flex items-center justify-between p-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                    <div>
                      <p className="font-mono text-xs text-zinc-500">{r.request_number}</p>
                      <p className="text-sm text-zinc-900 dark:text-zinc-100">{r.vendor?.name}</p>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="text-sm font-medium tabular-nums">{formatINR(r.payment_amount)}</span>
                      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                        {STATUS_LABEL[r.status] ?? r.status}
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}
