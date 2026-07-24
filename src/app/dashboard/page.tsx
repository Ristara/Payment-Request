import Link from "next/link";
import AppLayoutShell from "@/lib/appLayout";
import { getCurrentUserRoles, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ROLE_LABEL, STATUS_LABEL, formatINR } from "@/lib/types";

type Row = {
  id: string;
  request_number: string;
  vendor: { name: string } | null;
  created_at: string;
  installments: { installment_number: number; status: string; requested_amount: number }[];
};

function monthLabel(d: Date): string {
  return d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", month: "short" });
}

export default async function DashboardPage() {
  const user = await requireUser();
  const { roles } = await getCurrentUserRoles();
  const supabase = await createClient();

  const isApprover = roles.includes("approver");
  const isAccounts = roles.includes("accounts");
  const isAdmin = roles.includes("admin");
  const isStaff = isApprover || isAccounts || isAdmin;

  // Last 12 months of paid/closed spend for the chart
  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 11);
  twelveMonthsAgo.setDate(1);

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
    // Spend = paid installments (payment_record.paid_amount) by month of
    // payment_date. For submitters (non-staff), filtered to their threads below.
    supabase
      .from("payment_records")
      .select("paid_amount, payment_date, installment:request_installments!inner(request_id, request:payment_requests!inner(submitter_id))")
      .gte("payment_date", twelveMonthsAgo.toISOString().slice(0, 10))
      .not("payment_date", "is", null),
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
  type SpendRow = { paid_amount: number | null; payment_date: string | null; installment: { request: { submitter_id: string } | null } | { request: { submitter_id: string } | null }[] | null };
  const spendRaw = (spend ?? []) as unknown as SpendRow[];
  const spendRows = spendRaw
    .filter((r) => {
      if (isStaff) return true;
      const inst = Array.isArray(r.installment) ? r.installment[0] : r.installment;
      const req = Array.isArray(inst?.request) ? inst?.request[0] : inst?.request;
      return req?.submitter_id === user.id;
    })
    .map((r) => ({ payment_amount: Number(r.paid_amount ?? 0), created_at: r.payment_date ?? "" }));

  // Aggregate by month
  const monthTotals = new Map<string, number>();
  const months: { key: string; label: string; total: number }[] = [];
  const cursor = new Date(twelveMonthsAgo);
  for (let i = 0; i < 12; i++) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
    months.push({ key, label: monthLabel(cursor), total: 0 });
    monthTotals.set(key, 0);
    cursor.setMonth(cursor.getMonth() + 1);
  }
  for (const r of spendRows) {
    const d = new Date(r.created_at);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    monthTotals.set(key, (monthTotals.get(key) ?? 0) + Number(r.payment_amount));
  }
  months.forEach((m) => (m.total = monthTotals.get(m.key) ?? 0));
  const grandTotal = months.reduce((s, m) => s + m.total, 0);
  const maxMonth = Math.max(...months.map((m) => m.total), 1);

  const recentRows = (recentRes.data ?? []) as unknown as Row[];

  const displayName = profile.data?.full_name?.split(" ")[0] ?? user.email;

  return (
    <AppLayoutShell pageTitle="Dashboard">
      <div className="space-y-6">
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

        {/* Spend chart */}
        <section className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Spend summary</h2>
              <p className="text-xs text-zinc-500">
                {isStaff ? "Company-wide" : "Your requests"} — last 12 months
              </p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-semibold text-zinc-900 tabular-nums dark:text-zinc-100">
                {formatINR(grandTotal)}
              </p>
              <p className="text-[10px] uppercase tracking-wide text-zinc-500">total</p>
            </div>
          </div>

          <div className="mt-6">
            <SpendChart months={months} max={maxMonth} />
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
                    .filter((i) => i.status !== "cancelled" && i.status !== "rejected")
                    .reduce((s, i) => s + Number(i.requested_amount), 0);
                  return (
                    <li key={r.id} className="border-b border-zinc-100 last:border-b-0 dark:border-zinc-800">
                      <Link href={`/requests/${r.id}`} className="flex items-center justify-between px-5 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                        <div>
                          <p className="font-mono text-[11px] text-zinc-500">{r.request_number}</p>
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

/** Inline SVG line chart — no external chart lib. */
function SpendChart({ months, max }: { months: { label: string; total: number }[]; max: number }) {
  const W = 800;
  const H = 200;
  const PADX = 20;
  const PADY = 20;
  const stepX = (W - 2 * PADX) / Math.max(months.length - 1, 1);
  const y = (v: number) => H - PADY - (v / max) * (H - 2 * PADY);
  const points = months.map((m, i) => [PADX + i * stepX, y(m.total)] as const);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  const areaPath = `${path} L ${PADX + (months.length - 1) * stepX} ${H - PADY} L ${PADX} ${H - PADY} Z`;

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H + 24}`} className="w-full min-w-[500px]" preserveAspectRatio="none">
        {/* Grid lines */}
        {[0.25, 0.5, 0.75].map((r) => (
          <line
            key={r}
            x1={PADX}
            x2={W - PADX}
            y1={y(max * r)}
            y2={y(max * r)}
            stroke="currentColor"
            className="text-zinc-200 dark:text-zinc-800"
            strokeDasharray="2 4"
            strokeWidth="1"
          />
        ))}
        {/* Area fill */}
        <path d={areaPath} fill="url(#spendGradient)" />
        {/* Line */}
        <path d={path} fill="none" stroke="#4f46e5" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {/* Points */}
        {points.map((p, i) => (
          <circle key={i} cx={p[0]} cy={p[1]} r="3.5" fill="white" stroke="#4f46e5" strokeWidth="2" />
        ))}
        {/* Month labels */}
        {months.map((m, i) => (
          <text
            key={m.label + i}
            x={PADX + i * stepX}
            y={H + 16}
            textAnchor="middle"
            className="fill-zinc-500 text-[10px]"
          >
            {m.label}
          </text>
        ))}
        <defs>
          <linearGradient id="spendGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4f46e5" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#4f46e5" stopOpacity="0" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
}
