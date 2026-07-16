import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatINR } from "@/lib/types";

type Row = {
  id: string;
  request_number: string;
  payment_amount: number;
  tentative_invoice_date: string | null;
  payment_due_date: string;
  vendor: { name: string } | null;
  submitter: { full_name: string } | null;
};

function ageDays(iso: string | null): number {
  if (!iso) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 3600 * 1000)));
}

export default async function InvoicePendingReport() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("payment_requests")
    .select(
      `id, request_number, payment_amount, tentative_invoice_date, payment_due_date,
       vendor:vendors(name),
       submitter:profiles!payment_requests_submitter_id_fkey(full_name)`,
    )
    .eq("status", "invoice_pending")
    .order("tentative_invoice_date");

  const rows = (data ?? []) as unknown as Row[];
  const total = rows.reduce((s, r) => s + Number(r.payment_amount), 0);

  return (
    <div>
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Invoice pending</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Paid requests where the tax invoice hasn&apos;t been uploaded yet.
      </p>
      <p className="mt-4 text-sm text-zinc-500">
        <span className="font-semibold text-zinc-900 dark:text-zinc-100 tabular-nums">{formatINR(total)}</span> across {rows.length} request{rows.length === 1 ? "" : "s"}
      </p>

      <section className="mt-6 rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <table className="w-full text-sm">
          <thead className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
            <tr>
              <th className="px-5 py-3">Request #</th>
              <th className="px-5 py-3">Vendor</th>
              <th className="px-5 py-3">Raised by</th>
              <th className="px-5 py-3 text-right">Amount</th>
              <th className="px-5 py-3">Tentative date</th>
              <th className="px-5 py-3 text-right">Age</th>
              <th className="px-5 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-5 py-12 text-center text-sm text-zinc-500">
                  Clean. No invoice-pending requests.
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const age = ageDays(r.tentative_invoice_date);
                const ageColor = age > 30 ? "text-red-600" : age > 15 ? "text-orange-600" : age > 7 ? "text-amber-700" : "text-zinc-500";
                return (
                  <tr key={r.id} className="border-b border-zinc-100 last:border-b-0 dark:border-zinc-800">
                    <td className="px-5 py-2 font-mono text-xs">{r.request_number}</td>
                    <td className="px-5 py-2">{r.vendor?.name}</td>
                    <td className="px-5 py-2 text-zinc-500">{r.submitter?.full_name ?? "—"}</td>
                    <td className="px-5 py-2 text-right tabular-nums">{formatINR(r.payment_amount)}</td>
                    <td className="px-5 py-2 text-zinc-500">{r.tentative_invoice_date ?? "—"}</td>
                    <td className={`px-5 py-2 text-right font-medium tabular-nums ${ageColor}`}>
                      {age}d
                    </td>
                    <td className="px-5 py-2 text-right">
                      <Link href={`/requests/${r.id}`} className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                        Open →
                      </Link>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
