import { createClient } from "@/lib/supabase/server";
import { PIPELINE_LABEL, pipelineBucket } from "@/lib/types";
import PivotReport, { type PivotRow } from "./pivot-report";

type InstRow = {
  id: string;
  requested_amount: number | null;
  status: string;
  queued_for_upload_at: string | null;
  request: {
    id: string;
    created_at: string;
    expense_type: string | null;
    payment_kind: string | null;
    vendor: { name: string } | null;
    submitter: { full_name: string } | null;
    outlets: { outlet: { name: string; stage: string } | null }[];
    lines: {
      amount: number | null;
      coa_account: { subcategory: string; category: string; coa: string } | null;
    }[];
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

  // Grained by INSTALMENT, not by line item, so one request can sit in two
  // stages at once — an instalment paid while another still awaits approval.
  // That is what makes all seven pipeline stages reachable, and what lets
  // these totals reconcile with the dashboard.
  let query = supabase
    .from("request_installments")
    .select(
      `id, requested_amount, status, queued_for_upload_at,
       request:payment_requests!inner(id, created_at, expense_type, payment_kind,
         vendor:vendors(name),
         submitter:profiles!payment_requests_submitter_id_fkey(full_name),
         outlets:request_outlets(outlet:outlets(name, stage)),
         lines:request_line_items(amount, coa_account:coa_accounts(subcategory, category, coa)))`,
    );

  if (from) query = query.gte("request.created_at", from);
  if (to) query = query.lte("request.created_at", `${to}T23:59:59`);

  const { data } = await query.order("id");
  const rawInst = (data ?? []) as unknown as InstRow[];

  const rows: PivotRow[] = [];
  for (const inst of rawInst) {
    const req = inst.request;
    if (!req) continue;
    // Null for draft, rejected and cancelled — nothing in the pipeline.
    const bucket = pipelineBucket(inst.status, inst.queued_for_upload_at);
    if (!bucket) continue;

    const amount = Number(inst.requested_amount ?? 0);
    const d = new Date(req.created_at);
    const outlets = req.outlets
      .map((o) => o.outlet)
      .filter((o): o is { name: string; stage: string } => !!o);
    const lines = req.lines ?? [];
    const lineTotal = lines.reduce((s, l) => s + Number(l.amount ?? 0), 0);

    // An instalment is money against the whole request, not against one line
    // of it or one branch. Rather than attributing all of it to the first of
    // each and overstating that one, it is spread: evenly across branches (the
    // same even split the dashboard describes) and pro-rata by line value.
    // Every part still sums back to the instalment, so no total moves.
    const branches = outlets.length > 0 ? outlets : [null];
    const parts =
      lines.length > 0 && lineTotal > 0
        ? lines.map((l) => ({ line: l, share: Number(l.amount ?? 0) / lineTotal }))
        : [{ line: null as (typeof lines)[number] | null, share: 1 }];

    for (const o of branches) {
      for (const { line, share } of parts) {
        rows.push({
          id: `${inst.id}|${o?.name ?? ""}|${line?.coa_account?.subcategory ?? ""}`,
          requestId: req.id,
          amount: (amount / branches.length) * share,
          coa: line?.coa_account?.coa ?? "—",
          category: line?.coa_account?.category ?? "—",
          account: line?.coa_account?.subcategory ?? "—",
          vendor: req.vendor?.name ?? "—",
          outlet: o?.name ?? "—",
          stage:
            o?.stage === "upcoming"
              ? "New Store"
              : o?.stage === "operational"
                ? "Existing Outlet"
                : "—",
          expense:
            req.expense_type === "opex" ? "OpEx" : req.expense_type === "capex" ? "CapEx" : "—",
          kind:
            req.payment_kind === "milestone"
              ? "Milestone"
              : req.payment_kind === "regular"
                ? "Regular"
                : "—",
          raisedBy: req.submitter?.full_name ?? "—",
          status: PIPELINE_LABEL[bucket],
          month: `${MONTHS[d.getMonth()]} ${d.getFullYear()}`,
        });
      }
    }
  }

  return (
    <div>
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Spend report</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Every instalment in the pipeline, by amount requested. Excludes drafts,
          rejected and cancelled. Split evenly when raised against several branches.
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
