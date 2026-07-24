import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatINR, shortRequestNumber } from "@/lib/types";

type Row = {
  id: string;
  installment_number: number;
  requested_amount: number;
  payment_due_date: string;
  request: { id: string; request_number: string; vendor: { name: string } | null } | null;
};

function daysUntil(iso: string): number {
  const now = new Date();
  const then = new Date(iso);
  return Math.floor((then.getTime() - now.getTime()) / (24 * 3600 * 1000));
}

export default async function CashflowReport() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("request_installments")
    .select(
      `id, installment_number, requested_amount, payment_due_date,
       request:payment_requests!inner(id, request_number, vendor:vendors(name))`,
    )
    .in("status", ["approved", "uploaded_in_bank"])
    .order("payment_due_date");

  const rows = (data ?? []) as unknown as Row[];

  const buckets = [
    { key: "overdue", label: "Overdue", filter: (r: Row) => daysUntil(r.payment_due_date) < 0 },
    { key: "today", label: "Due today", filter: (r: Row) => daysUntil(r.payment_due_date) === 0 },
    { key: "week", label: "Due this week", filter: (r: Row) => { const d = daysUntil(r.payment_due_date); return d > 0 && d <= 7; } },
    { key: "month", label: "Due this month", filter: (r: Row) => { const d = daysUntil(r.payment_due_date); return d > 7 && d <= 30; } },
    { key: "later", label: "Later", filter: (r: Row) => daysUntil(r.payment_due_date) > 30 },
  ];

  const grouped = buckets.map((b) => ({ ...b, rows: rows.filter(b.filter) }));
  const grandTotal = rows.reduce((s, r) => s + Number(r.requested_amount), 0);

  return (
    <div>
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Cash-flow due</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Approved installments not yet paid, grouped by when they&apos;re due.
      </p>
      <p className="mt-4 text-sm text-zinc-500">
        <span className="font-semibold text-zinc-900 dark:text-zinc-100 tabular-nums">{formatINR(grandTotal)}</span> total
      </p>

      <div className="mt-6 space-y-6">
        {grouped.map((g) => {
          if (g.rows.length === 0) return null;
          const bTotal = g.rows.reduce((s, r) => s + Number(r.requested_amount), 0);
          const isOverdue = g.key === "overdue";
          const isToday = g.key === "today";
          return (
            <section key={g.key}>
              <h2 className={`text-sm font-semibold ${isOverdue ? "text-red-700 dark:text-red-300" : isToday ? "text-orange-700 dark:text-orange-300" : "text-zinc-800 dark:text-zinc-200"}`}>
                {g.label} · {g.rows.length} · <span className="tabular-nums">{formatINR(bTotal)}</span>
              </h2>
              <div className="mt-3 overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
                <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-sm">
                  <tbody>
                    {g.rows.map((r) => (
                      <tr key={r.id} className="border-b border-zinc-100 last:border-b-0 dark:border-zinc-800">
                        <td className="px-5 py-2 font-mono text-xs">
                          <Link
                            href={`/requests/${r.request?.id}`}
                            className="font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                          >
                            {shortRequestNumber(r.request?.request_number)} · #{r.installment_number}
                          </Link>
                        </td>
                        <td className="px-5 py-2">{r.request?.vendor?.name}</td>
                        <td className="px-5 py-2 text-right tabular-nums">{formatINR(r.requested_amount)}</td>
                        <td className="px-5 py-2 text-zinc-500">{r.payment_due_date}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
