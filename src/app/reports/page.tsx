import { createClient } from "@/lib/supabase/server";
import { formatINR } from "@/lib/types";

type LineRow = {
  id: string;
  amount: number;
  coa_account: { subcategory: string; category: string; coa: string } | null;
  request: {
    id: string;
    request_number: string;
    created_at: string;
    vendor: { name: string } | null;
    outlets: { outlet: { name: string } | null }[];
    installments: { status: string }[];
  } | null;
};

export default async function SpendReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; groupBy?: string }>;
}) {
  const { from, to, groupBy = "coa" } = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from("request_line_items")
    .select(
      `id, amount,
       coa_account:coa_accounts(subcategory, category, coa),
       request:payment_requests!inner(id, request_number, created_at,
         vendor:vendors(name),
         outlets:request_outlets(outlet:outlets(name)),
         installments:request_installments(status))`,
    );

  if (from) query = query.gte("request.created_at", from);
  if (to) query = query.lte("request.created_at", `${to}T23:59:59`);

  const { data } = await query.order("id");
  const rawLines = (data ?? []) as unknown as LineRow[];
  // Only include lines from threads that have at least one approved-or-later
  // installment (i.e. real spend is in motion). Drafts / all-rejected threads
  // aren't counted.
  const spendStatuses = new Set(["approved", "uploaded_in_bank", "invoice_pending", "payment_processed", "closed"]);
  const lines = rawLines.filter((l) => {
    if (!l.request) return false;
    return (l.request.installments ?? []).some((i) => spendStatuses.has(i.status));
  });

  // Aggregate
  const buckets = new Map<string, { label: string; count: number; total: number; requestIds: Set<string> }>();
  for (const l of lines) {
    let key = "—";
    let label = "—";
    if (groupBy === "coa") {
      key = l.coa_account?.coa ?? "—";
      label = l.coa_account?.coa ?? "—";
    } else if (groupBy === "subcategory") {
      key = l.coa_account?.subcategory ?? "—";
      label = key;
    } else if (groupBy === "vendor") {
      key = l.request?.vendor?.name ?? "—";
      label = key;
    } else if (groupBy === "category") {
      key = l.coa_account?.category ?? "—";
      label = key;
    } else if (groupBy === "outlet") {
      key = l.request?.outlets.map((o) => o.outlet?.name ?? "").filter(Boolean).join(", ") || "—";
      label = key;
    }
    const cur = buckets.get(key) ?? { label, count: 0, total: 0, requestIds: new Set<string>() };
    cur.total += Number(l.amount);
    if (l.request) cur.requestIds.add(l.request.id);
    cur.count = cur.requestIds.size;
    buckets.set(key, cur);
  }
  const sorted = [...buckets.entries()].sort((a, b) => b[1].total - a[1].total);
  const grandTotal = lines.reduce((sum, l) => sum + Number(l.amount), 0);
  const uniqueRequests = new Set(lines.map((l) => l.request?.id).filter(Boolean)).size;

  return (
    <div>
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Spend report</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Aggregated from request line items. Excludes drafts, rejected, cancelled.
          </p>
        </div>
      </div>

      <form className="mt-6 flex flex-wrap items-end gap-3 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div>
          <label className="block text-xs text-zinc-500">From</label>
          <input name="from" type="date" defaultValue={from} className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
        </div>
        <div>
          <label className="block text-xs text-zinc-500">To</label>
          <input name="to" type="date" defaultValue={to} className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
        </div>
        <div>
          <label className="block text-xs text-zinc-500">Group by</label>
          <select name="groupBy" defaultValue={groupBy} className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900">
            <option value="subcategory">Subcategory</option>
            <option value="category">Category</option>
            <option value="coa">COA head</option>
            <option value="vendor">Vendor</option>
            <option value="outlet">Outlet</option>
          </select>
        </div>
        <button className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700">
          Apply
        </button>
      </form>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_18rem]">
        <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
              <tr>
                <th className="px-5 py-3">
                  {groupBy === "coa" ? "COA head" : groupBy === "vendor" ? "Vendor" : groupBy === "category" ? "Category" : groupBy === "outlet" ? "Outlet" : "Subcategory"}
                </th>
                <th className="px-5 py-3 text-right">Requests</th>
                <th className="px-5 py-3 text-right">Total</th>
                <th className="px-5 py-3 text-right">% of total</th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-5 py-12 text-center text-sm text-zinc-500">
                    No spend in this window.
                  </td>
                </tr>
              ) : (
                sorted.map(([key, b]) => (
                  <tr key={key} className="border-b border-zinc-100 last:border-b-0 dark:border-zinc-800">
                    <td className="px-5 py-2 text-zinc-900 dark:text-zinc-100">{b.label}</td>
                    <td className="px-5 py-2 text-right text-zinc-500 tabular-nums">{b.count}</td>
                    <td className="px-5 py-2 text-right font-medium tabular-nums">{formatINR(b.total)}</td>
                    <td className="px-5 py-2 text-right text-zinc-500 tabular-nums">
                      {grandTotal > 0 ? ((b.total / grandTotal) * 100).toFixed(1) : "0"}%
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot>
              <tr className="border-t border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950">
                <td className="px-5 py-3 text-xs font-semibold uppercase text-zinc-500">Total</td>
                <td className="px-5 py-3 text-right font-semibold tabular-nums">{uniqueRequests}</td>
                <td className="px-5 py-3 text-right font-semibold tabular-nums">{formatINR(grandTotal)}</td>
                <td className="px-5 py-3 text-right text-zinc-500">100%</td>
              </tr>
            </tfoot>
          </table>
          </div>
        </section>

        <aside className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Summary</h2>
          <p className="mt-3 text-3xl font-semibold text-zinc-900 dark:text-zinc-50 tabular-nums">
            {formatINR(grandTotal)}
          </p>
          <p className="mt-1 text-xs text-zinc-500">across {uniqueRequests} request{uniqueRequests === 1 ? "" : "s"}</p>
        </aside>
      </div>
    </div>
  );
}
