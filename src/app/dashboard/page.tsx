import Link from "next/link";
import AppLayoutShell from "@/lib/appLayout";
import { getCurrentUserRoles, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ROLE_LABEL, STATUS_LABEL, formatINR, shortRequestNumber } from "@/lib/types";

type Row = {
  id: string;
  request_number: string;
  vendor: { name: string } | null;
  created_at: string;
  installments: { installment_number: number; status: string; requested_amount: number }[];
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string }>;
}) {
  const { denied } = await searchParams;
  const user = await requireUser();
  const { roles } = await getCurrentUserRoles();
  const supabase = await createClient();

  const isApprover = roles.includes("approver");
  const isAccounts = roles.includes("accounts");
  const isAdmin = roles.includes("admin");
  const isStaff = isApprover || isAccounts || isAdmin;


  // Everything on this page is independent — one parallel wave, no
  // serialized round-trips.
  const [profile, myCount, pendingApprovals, accountsQueue, spendRes, recentRes] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", user.id).single(),
    supabase.from("payment_requests").select("*", { count: "exact", head: true }).eq("submitter_id", user.id),
    isApprover
      ? supabase.from("request_installments").select("*", { count: "exact", head: true }).in("status", ["pending_approval", "clarification_required"])
      : Promise.resolve({ count: 0 }),
    isAccounts
      ? supabase.from("request_installments").select("*", { count: "exact", head: true }).in("status", ["approved", "uploaded_in_bank", "invoice_pending"])
      : Promise.resolve({ count: 0 }),
    // Every live installment with its status and the branches it is raised
    // against. Replaces the 12-month paid-spend chart: a total tells you the
    // past, whereas where it is stuck and whose budget it lands on is what you
    // act on. Non-staff are narrowed to their own threads below.
    supabase
      .from("request_installments")
      .select(
        `status, requested_amount,
         request:payment_requests!inner(submitter_id,
           request_outlets(outlet:outlets(name, cost_centre)))`,
      )
      .not("status", "in", "(draft,cancelled,rejected)"),
    supabase
      .from("payment_requests")
      .select(
        `id, request_number, created_at,
         vendor:vendors(name),
         installments:request_installments(installment_number, status, requested_amount)`,
      )
      .eq("submitter_id", user.id)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  const { data: spend } = spendRes;
  type InstRow = {
    status: string;
    requested_amount: number | null;
    request:
      | { submitter_id: string; request_outlets: { outlet: { name: string; cost_centre: string | null } | null }[] }
      | { submitter_id: string; request_outlets: { outlet: { name: string; cost_centre: string | null } | null }[] }[]
      | null;
  };
  const one = <T,>(v: T | T[] | null | undefined): T | null =>
    Array.isArray(v) ? (v[0] ?? null) : (v ?? null);

  const instRows = ((spend ?? []) as unknown as InstRow[]).filter((r) => {
    if (isStaff) return true;
    return one(r.request)?.submitter_id === user.id;
  });

  // ---- By status -----------------------------------------------------------
  // Pipeline order, not alphabetical and not by size: the point is to read it
  // left to right as work moving, and see where it has stopped.
  const STATUS_ORDER = [
    "pending_approval", "clarification_required", "approved",
    "uploaded_in_bank", "invoice_pending", "payment_processed", "closed",
  ];
  const byStatus = STATUS_ORDER.map((key) => {
    const rows = instRows.filter((r) => r.status === key);
    return {
      key,
      label: STATUS_LABEL[key] ?? key,
      count: rows.length,
      total: rows.reduce((sum, r) => sum + Number(r.requested_amount ?? 0), 0),
    };
  }).filter((s) => s.count > 0);
  const statusTotal = byStatus.reduce((sum, s) => sum + s.total, 0);
  const statusMax = Math.max(...byStatus.map((s) => s.total), 1);

  // ---- By cost centre ------------------------------------------------------
  // cost_centre is unset on every outlet today, so it falls back to the outlet
  // name — which is how these are actually referred to. Fill the codes in and
  // this groups by them instead, with no code change.
  //
  // An installment raised against several branches is SPLIT evenly between
  // them rather than counted once per branch. Counting it whole in each place
  // would make the column add up to more than was ever requested, and a
  // report whose total is wrong is worse than no report.
  const centreTotals = new Map<string, { total: number; count: number }>();
  for (const r of instRows) {
    const amount = Number(r.requested_amount ?? 0);
    const outlets = (one(r.request)?.request_outlets ?? [])
      .map((o) => one(o.outlet))
      .filter((o): o is { name: string; cost_centre: string | null } => !!o);
    const keys = outlets.length > 0
      ? outlets.map((o) => o.cost_centre?.trim() || o.name)
      : ["No branch"];
    const share = amount / keys.length;
    for (const k of keys) {
      const cur = centreTotals.get(k) ?? { total: 0, count: 0 };
      centreTotals.set(k, { total: cur.total + share, count: cur.count + 1 });
    }
  }
  const byCentre = [...centreTotals.entries()]
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.total - a.total);
  const centreMax = Math.max(...byCentre.map((c) => c.total), 1);

  const recentRows = (recentRes.data ?? []) as unknown as Row[];

  const displayName = profile.data?.full_name?.split(" ")[0] ?? user.email;

  return (
    <AppLayoutShell pageTitle="Dashboard">
      <div className="space-y-6">
        {/* Say why, rather than bouncing someone back with no explanation. */}
        {denied === "noaccess" && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            You haven&apos;t been given any branches or expense types to raise for yet. Ask an admin
            to set yours up.
          </p>
        )}
        {denied === "raise" && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            You don&apos;t have permission to raise payment requests. Ask an admin to give you the Requester role.
          </p>
        )}

        {/* Greeting */}
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
            Hello, {displayName}
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            {roles.length === 0 ? (
              <span className="text-amber-700 dark:text-amber-300">No roles assigned yet — ask your admin.</span>
            ) : (
              roles.map((r) => ROLE_LABEL[r] ?? r).join(" · ")
            )}
          </p>
        </div>

        {/* KPI tiles */}
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <KpiTile
            href="/requests"
            label="My requests"
            value={myCount.count ?? 0}
            accent="indigo"
          />
          {isApprover && (
            <KpiTile
              href="/approvals"
              label="Waiting on you"
              value={pendingApprovals.count ?? 0}
              accent={(pendingApprovals.count ?? 0) > 0 ? "amber" : "indigo"}
            />
          )}
          {isAccounts && (
            <KpiTile
              href="/accounts"
              label="Accounts queue"
              value={accountsQueue.count ?? 0}
              accent={(accountsQueue.count ?? 0) > 0 ? "sky" : "indigo"}
            />
          )}
          <KpiTile
            href="/requests/new"
            label="Raise request"
            value={"+"}
            accent="emerald"
          />
        </section>

        {/* Where the work is, and whose budget it lands on */}
        <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">By status</h2>
                <p className="text-xs text-zinc-500">
                  {isStaff ? "Company-wide" : "Your requests"} — amount requested
                </p>
              </div>
              <div className="text-right">
                <p className="text-xl font-semibold text-zinc-900 tabular-nums dark:text-zinc-100">
                  {formatINR(statusTotal)}
                </p>
                <p className="text-[10px] uppercase tracking-wide text-zinc-500">in flight</p>
              </div>
            </div>
            {byStatus.length === 0 ? (
              <p className="mt-6 text-sm text-zinc-500">Nothing raised yet.</p>
            ) : (
              <ul className="mt-5 space-y-3">
                {byStatus.map((s) => (
                  <li key={s.key}>
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="truncate text-zinc-700 dark:text-zinc-300">
                        {s.label}
                        <span className="ml-1.5 text-xs text-zinc-400">{s.count}</span>
                      </span>
                      <span className="shrink-0 font-medium tabular-nums text-zinc-900 dark:text-zinc-100">
                        {formatINR(s.total)}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                      <div
                        className="h-full rounded-full bg-indigo-500"
                        style={{ width: `${Math.max(2, (s.total / statusMax) * 100)}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
            <div>
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">By cost centre</h2>
              <p className="text-xs text-zinc-500">
                Highest first. Split evenly when raised against several branches.
              </p>
            </div>
            {byCentre.length === 0 ? (
              <p className="mt-6 text-sm text-zinc-500">Nothing raised yet.</p>
            ) : (
              <ul className="mt-5 space-y-3">
                {byCentre.map((c) => (
                  <li key={c.name}>
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="truncate text-zinc-700 dark:text-zinc-300">
                        {c.name}
                        <span className="ml-1.5 text-xs text-zinc-400">{c.count}</span>
                      </span>
                      <span className="shrink-0 font-medium tabular-nums text-zinc-900 dark:text-zinc-100">
                        {formatINR(c.total)}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                      <div
                        className="h-full rounded-full bg-emerald-500"
                        style={{ width: `${Math.max(2, (c.total / centreMax) * 100)}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* Two-column: recent requests + quick links */}
        <section className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="rounded-xl border border-zinc-200 bg-white lg:col-span-2 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-3 dark:border-zinc-800">
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Recent requests</h2>
              <Link href="/requests" className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                See all →
              </Link>
            </div>
            {recentRows.length === 0 ? (
              <p className="p-6 text-center text-sm text-zinc-500">
                No requests yet. <Link href="/requests/new" className="text-indigo-600 underline">Raise your first</Link>.
              </p>
            ) : (
              <ul>
                {recentRows.map((r) => {
                  const insts = [...(r.installments ?? [])].sort((a, b) => a.installment_number - b.installment_number);
                  const latest = insts[insts.length - 1];
                  const requestedTotal = insts
                    .filter((i) => !["cancelled", "rejected", "draft"].includes(i.status))
                    .reduce((s, i) => s + Number(i.requested_amount), 0);
                  return (
                    <li key={r.id} className="border-b border-zinc-100 last:border-b-0 dark:border-zinc-800">
                      <Link href={`/requests/${r.id}`} className="flex items-center justify-between px-5 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                        <div>
                          <p className="font-mono text-[11px] text-zinc-500">{shortRequestNumber(r.request_number)}</p>
                          <p className="text-sm text-zinc-900 dark:text-zinc-100">{r.vendor?.name ?? "—"}</p>
                        </div>
                        <div className="flex items-center gap-4">
                          <span className="text-sm font-medium tabular-nums text-zinc-900 dark:text-zinc-100">
                            {formatINR(requestedTotal)}
                          </span>
                          {latest && <StatusChip status={latest.status} />}
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <div className="border-b border-zinc-100 px-5 py-3 dark:border-zinc-800">
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Quick links</h2>
            </div>
            <ul className="p-2">
              <QuickLink href="/requests/new" label="Raise a payment request" />
              <QuickLink href="/vendors/new" label="Add a new vendor" />
              {isStaff && <QuickLink href="/reports" label="Spend report" />}
              {isStaff && <QuickLink href="/reports/invoice-pending" label="Invoice pending" />}
              {isStaff && <QuickLink href="/reports/cashflow" label="Cash-flow due" />}
              <QuickLink href="/notifications" label="Notifications inbox" />
              {isAdmin && <QuickLink href="/admin" label="Admin console" />}
            </ul>
          </div>
        </section>
      </div>
    </AppLayoutShell>
  );
}

function KpiTile({
  href,
  label,
  value,
  accent,
}: {
  href: string;
  label: string;
  value: number | string;
  accent: "indigo" | "amber" | "sky" | "emerald";
}) {
  const accents = {
    indigo: "border-indigo-100 bg-white text-indigo-600 dark:border-indigo-900 dark:bg-zinc-900 dark:text-indigo-300",
    amber: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
    sky: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200",
  }[accent];
  return (
    <Link href={href} className={`block rounded-xl border p-4 hover:shadow-sm ${accents}`}>
      <p className="text-[11px] font-medium uppercase tracking-wider opacity-70">{label}</p>
      <p className="mt-2 text-3xl font-semibold tabular-nums">{value}</p>
    </Link>
  );
}

function QuickLink({ href, label }: { href: string; label: string }) {
  return (
    <li>
      <Link
        href={href}
        className="flex items-center justify-between rounded-md px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        <span>{label}</span>
        <span className="text-zinc-400">→</span>
      </Link>
    </li>
  );
}

function StatusChip({ status }: { status: string }) {
  const color =
    status === "closed" || status === "payment_processed"
      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200"
      : status === "rejected" || status === "cancelled"
        ? "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-200"
        : status === "returned_for_correction" || status === "clarification_required"
          ? "bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-200"
          : status === "approved" || status === "uploaded_in_bank" || status === "invoice_pending"
            ? "bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-200"
            : "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-200";
  return (
    <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium ${color}`}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}
