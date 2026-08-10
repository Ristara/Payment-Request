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
  searchParams: Promise<{ denied?: string; exp?: string }>;
}) {
  const { denied, exp: expRaw } = await searchParams;
  // CapEx and OpEx are reported separately: they are different money with
  // different owners, and a single table mixing rent into a construction
  // budget is not a number anyone can act on. CapEx leads because that is
  // where the project spend lives.
  const expense: "capex" | "opex" = expRaw === "opex" ? "opex" : "capex";
  const EXPENSE_TITLE = { capex: "CapEx", opex: "OpEx" } as const;
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
        `status, requested_amount, queued_for_upload_at,
         request:payment_requests!inner(submitter_id, expense_type,
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
    /** "Approved" and "To upload" are the same status; this is what separates them. */
    queued_for_upload_at: string | null;
    request:
      | { submitter_id: string; expense_type: string | null; request_outlets: { outlet: { name: string; cost_centre: string | null } | null }[] }
      | { submitter_id: string; expense_type: string | null; request_outlets: { outlet: { name: string; cost_centre: string | null } | null }[] }[]
      | null;
  };
  const one = <T,>(v: T | T[] | null | undefined): T | null =>
    Array.isArray(v) ? (v[0] ?? null) : (v ?? null);

  const instRows = ((spend ?? []) as unknown as InstRow[]).filter((r) => {
    const req = one(r.request);
    // Rows predating migration 031 were backfilled to capex, so a null here
    // would only be a row written outside the app — treat it as capex rather
    // than dropping it silently from both views.
    if ((req?.expense_type ?? "capex") !== expense) return false;
    if (isStaff) return true;
    return req?.submitter_id === user.id;
  });

  // ---- Cost centre × status matrix -----------------------------------------
  //
  // The columns are the stages of the pipeline as Accounts works it, in the
  // order they happen. "Approved" and "To upload" share a status — what
  // separates them is whether the installment has been queued into the next
  // bank file — so the bucket is decided here rather than by status alone.
  const COLUMNS = [
    { key: "pending", label: "Pending for approval" },
    { key: "approved", label: "Approved" },
    { key: "to_upload", label: "To upload" },
    { key: "in_bank", label: "In bank" },
    // Both of these mean the money has LEFT THE BANK. What separates them is
    // only whether the vendor's invoice has arrived: recording a payment sets
    // payment_processed when an invoice is already attached and
    // invoice_pending when it is not.
    //
    // Labelled "Paid" and "Invoice pending", a row reading "— / ₹4,00,000"
    // said nothing had been paid at that branch when ₹4,00,000 already had.
    // Both now carry the word, matching how the Accounts page reads.
    { key: "invoice_pending", label: "Paid · invoice due" },
    { key: "paid", label: "Paid · to close" },
    { key: "closed", label: "Closed" },
  ] as const;
  type ColKey = (typeof COLUMNS)[number]["key"];

  function bucketOf(r: InstRow): ColKey | null {
    switch (r.status) {
      case "pending_approval":
      case "clarification_required":
        return "pending";
      case "approved":
        return r.queued_for_upload_at ? "to_upload" : "approved";
      case "uploaded_in_bank":
        return "in_bank";
      case "payment_processed":
        return "paid";
      case "invoice_pending":
        return "invoice_pending";
      case "closed":
        return "closed";
      default:
        return null;
    }
  }

  const emptyRow = (): Record<ColKey, number> =>
    Object.fromEntries(COLUMNS.map((c) => [c.key, 0])) as Record<ColKey, number>;

  const matrix = new Map<string, Record<ColKey, number>>();
  for (const r of instRows) {
    const col = bucketOf(r);
    if (!col) continue;
    const amount = Number(r.requested_amount ?? 0);
    const outlets = (one(r.request)?.request_outlets ?? [])
      .map((o) => one(o.outlet))
      .filter((o): o is { name: string; cost_centre: string | null } => !!o);
    // cost_centre is unset on every outlet today, so this falls back to the
    // outlet name. Fill the codes in and it groups by them, no code change.
    const keys = outlets.length > 0
      ? [...new Set(outlets.map((o) => o.cost_centre?.trim() || o.name))]
      : ["No branch"];
    // Split, never counted whole in each place: otherwise the Total row adds
    // up to more than was ever requested.
    const share = amount / keys.length;
    for (const k of keys) {
      const row = matrix.get(k) ?? emptyRow();
      row[col] += share;
      matrix.set(k, row);
    }
  }

  const rowTotal = (r: Record<ColKey, number>) =>
    COLUMNS.reduce((sum, c) => sum + r[c.key], 0);
  const centreRows = [...matrix.entries()]
    .map(([name, cells]) => ({ name, cells, total: rowTotal(cells) }))
    .sort((a, b) => b.total - a.total);
  const columnTotals = Object.fromEntries(
    COLUMNS.map((c) => [c.key, centreRows.reduce((sum, r) => sum + r.cells[c.key], 0)]),
  ) as Record<ColKey, number>;
  const grandTotal = centreRows.reduce((sum, r) => sum + r.total, 0);

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

        {/* CapEx and OpEx are different money with different owners, and one
            table mixing rent into a construction budget is not a figure anyone
            can act on. Shown one at a time rather than stacked: reading a
            number off the wrong table is easy when they look identical.

            Same underlined strip as Approvals and Accounts, spanning the width
            — a pill floating at the left read as a stray control rather than
            the thing that governs the table below it. */}
        <nav
          aria-label="Expense type"
          className="-mx-4 flex items-center gap-1 overflow-x-auto border-b border-zinc-200 px-4 sm:mx-0 sm:px-0 dark:border-zinc-800"
        >
          {(["capex", "opex"] as const).map((k) => {
            const active = expense === k;
            return (
              <Link
                key={k}
                href={k === "capex" ? "/dashboard" : "/dashboard?exp=opex"}
                aria-current={active ? "page" : undefined}
                className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm ${
                  active
                    ? "border-indigo-600 font-medium text-indigo-700 dark:text-indigo-300"
                    : "border-transparent text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                }`}
              >
                {EXPENSE_TITLE[k]}
              </Link>
            );
          })}
        </nav>

        <MatrixTable
          heading={`${EXPENSE_TITLE[expense]} — cost centre by status`}
          note={`${isStaff ? "Company-wide" : "Your requests"}, ${EXPENSE_TITLE[expense]} only — amount requested. Split evenly when raised against several branches.`}
          firstColumn="Cost centre"
          columns={COLUMNS}
          rows={centreRows}
          columnTotals={columnTotals}
          grandTotal={grandTotal}
        />

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

/**
 * A cost-centre-style cross-tab: rows down, pipeline stages across, totals both
 * ways. Shared by the branch and project reports so the two cannot drift into
 * looking or behaving differently.
 */
function MatrixTable<K extends string>({
  heading,
  note,
  firstColumn,
  columns,
  rows,
  columnTotals,
  grandTotal,
}: {
  heading: string;
  note: string;
  firstColumn: string;
  columns: readonly { key: K; label: string }[];
  rows: { name: string; cells: Record<K, number>; total: number }[];
  columnTotals: Record<K, number>;
  grandTotal: number;
}) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-zinc-100 px-5 py-3 dark:border-zinc-800">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{heading}</h2>
          <p className="text-xs text-zinc-500">{note}</p>
        </div>
        <p className="text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
          {formatINR(grandTotal)}
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="p-6 text-center text-sm text-zinc-500">Nothing raised yet.</p>
      ) : (
        /* The table scrolls, not the page: eight columns will not fit a phone,
           and the first column is pinned so a row stays identifiable once it
           has been scrolled sideways. */
        <div className="overflow-x-auto">
          <table className="w-full min-w-[46rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-zinc-100 text-left text-[11px] uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
                <th className="sticky left-0 z-10 bg-white px-5 py-3 font-medium dark:bg-zinc-900">
                  {firstColumn}
                </th>
                {columns.map((c) => (
                  <th key={c.key} className="px-3 py-3 text-right font-medium whitespace-nowrap">
                    {c.label}
                  </th>
                ))}
                <th className="px-5 py-3 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name} className="border-b border-zinc-100 last:border-b-0 dark:border-zinc-800">
                  <th
                    scope="row"
                    className="sticky left-0 z-10 max-w-[16rem] truncate bg-white px-5 py-2.5 text-left font-medium text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100"
                    title={r.name}
                  >
                    {r.name}
                  </th>
                  {columns.map((c) => (
                    <td key={c.key} className="px-3 py-2.5 text-right tabular-nums">
                      {/* A dash, not ₹0.00 — an empty cell should read as nothing
                          there, and a grid of zeroes hides the real figures. */}
                      {r.cells[c.key] > 0 ? (
                        <span className="text-zinc-700 dark:text-zinc-300">{formatINR(r.cells[c.key])}</span>
                      ) : (
                        <span className="text-zinc-300 dark:text-zinc-700">—</span>
                      )}
                    </td>
                  ))}
                  <td className="px-5 py-2.5 text-right font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                    {formatINR(r.total)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950">
                <th
                  scope="row"
                  className="sticky left-0 z-10 bg-zinc-50 px-5 py-3 text-left font-semibold text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100"
                >
                  Total
                </th>
                {columns.map((c) => (
                  <td key={c.key} className="px-3 py-3 text-right font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                    {columnTotals[c.key] > 0 ? formatINR(columnTotals[c.key]) : "—"}
                  </td>
                ))}
                <td className="px-5 py-3 text-right font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                  {formatINR(grandTotal)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
