import { createClient } from "@/lib/supabase/server";
import { STATUS_LABEL, deriveThreadStatus } from "@/lib/types";
import PivotReport, { type PivotRow } from "./pivot-report";

type LineRow = {
  id: string;
  amount: number;
  coa_account: { subcategory: string; category: string; coa: string } | null;
  request: {
    id: string;
    request_number: string;
    created_at: string;
    expense_type: string | null;
    payment_kind: string | null;
    vendor: { name: string } | null;
    submitter: { full_name: string } | null;
    outlets: { outlet: { name: string; stage: string } | null }[];
    installments: { status: string }[];
  } | null;
};

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export default async function SpendReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { from, to } = await searchParams;
  const supabase = await createClient();

  // Everything a pivot might group by, fetched flat and once. The shaping is
  // done in the browser: which fields end up on rows, columns or filters is a
  // decision the user makes and changes constantly, and a round trip per
  // rearrangement would make dragging a field feel broken.
  let query = supabase
    .from("request_line_items")
    .select(
      `id, amount,
       coa_account:coa_accounts(subcategory, category, coa),
       request:payment_requests!inner(id, request_number, created_at, expense_type, payment_kind,
         vendor:vendors(name),
         submitter:profiles!payment_requests_submitter_id_fkey(full_name),
         outlets:request_outlets(outlet:outlets(name, stage)),
         installments:request_installments(status))`,
    );

  if (from) query = query.gte("request.created_at", from);
  if (to) query = query.lte("request.created_at", `${to}T23:59:59`);

  const { data } = await query.order("id");
  const rawLines = (data ?? []) as unknown as LineRow[];

  // Only lines from threads with at least one approved-or-later installment —
  // real spend in motion. Drafts and all-rejected threads are not spend.
  const spendStatuses = new Set([
    "approved", "uploaded_in_bank", "invoice_pending", "payment_processed", "closed",
  ]);
  const rows: PivotRow[] = rawLines
    .filter((l) => l.request && (l.request.installments ?? []).some((i) => spendStatuses.has(i.status)))
    .map((l) => {
      const d = new Date(l.request!.created_at);
      const outlet =
        l.request!.outlets.map((o) => o.outlet?.name ?? "").filter(Boolean).join(", ") || "—";
      const stage = l.request!.outlets[0]?.outlet?.stage;
      return {
        id: l.id,
        requestId: l.request!.id,
        amount: Number(l.amount),
        coa: l.coa_account?.coa ?? "—",
        category: l.coa_account?.category ?? "—",
        account: l.coa_account?.subcategory ?? "—",
        vendor: l.request!.vendor?.name ?? "—",
        outlet,
        stage: stage === "upcoming" ? "New Store" : stage === "operational" ? "Existing Outlet" : "—",
        expense: l.request!.expense_type === "opex" ? "OpEx" : l.request!.expense_type === "capex" ? "CapEx" : "—",
        kind: l.request!.payment_kind === "milestone" ? "Milestone" : l.request!.payment_kind === "regular" ? "Regular" : "—",
        raisedBy: l.request!.submitter?.full_name ?? "—",
        // The same single status the request itself shows, from the same
        // helper — a report that disagreed with the badge on the request
        // would just make people distrust both.
        status:
          STATUS_LABEL[
            deriveThreadStatus((l.request!.installments ?? []).map((i) => i.status))
          ] ?? "—",
        month: `${MONTHS[d.getMonth()]} ${d.getFullYear()}`,
      };
    });

  return (
    <div>
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Spend report</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Aggregated from request line items. Excludes drafts, rejected, cancelled.
        </p>
      </div>

      <form className="mt-6 flex flex-wrap items-end gap-3 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div>
          <label className="block text-xs text-zinc-500">From</label>
          <input
            name="from"
            type="date"
            defaultValue={from}
            className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </div>
        <div>
          <label className="block text-xs text-zinc-500">To</label>
          <input
            name="to"
            type="date"
            defaultValue={to}
            className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </div>
        <button className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700">
          Apply
        </button>
        <p className="w-full text-xs text-zinc-500 sm:w-auto sm:self-center">
          The date range is fetched from the server. Everything below it rearranges instantly.
        </p>
      </form>

      <PivotReport rows={rows} />
    </div>
  );
}
