import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { STATUS_LABEL, formatINR } from "@/lib/types";
import PageHeader from "@/components/PageHeader";

type Row = {
  id: string;
  request_number: string;
  status: string;
  payment_amount: number;
  payment_due_date: string;
  created_at: string;
  vendor: { name: string } | null;
};

export default async function MyRequestsPage() {
  const user = await requireUser();
  const supabase = await createClient();
  const { data } = await supabase
    .from("payment_requests")
    .select("id, request_number, status, payment_amount, payment_due_date, created_at, vendor:vendors(name)")
    .eq("submitter_id", user.id)
    .order("created_at", { ascending: false });
  const rows = (data ?? []) as unknown as Row[];

  return (
    <div>
      <PageHeader
        title="My requests"
        subtitle="Payment requests you have raised."
      />

      {rows.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
          No requests yet.{" "}
          <Link href="/requests/new" className="text-indigo-600 underline">Raise your first</Link>.
        </div>
      ) : (
        <>
          {/* Mobile card list */}
          <ul className="mt-6 space-y-3 sm:hidden">
            {rows.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/requests/${r.id}`}
                  className="block rounded-xl border border-zinc-200 bg-white p-4 active:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-[11px] text-zinc-500">{r.request_number}</p>
                      <p className="mt-0.5 truncate text-base font-medium text-zinc-900 dark:text-zinc-100">
                        {r.vendor?.name ?? "—"}
                      </p>
                    </div>
                    <StatusPill status={r.status} />
                  </div>
                  <div className="mt-2 flex items-baseline justify-between text-xs">
                    <span className="font-semibold text-zinc-900 tabular-nums dark:text-zinc-100">
                      {formatINR(r.payment_amount)}
                    </span>
                    <span className="text-zinc-500">Due {r.payment_due_date}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>

          {/* Desktop table */}
          <section className="mt-6 hidden rounded-2xl border border-zinc-200 bg-white sm:block dark:border-zinc-800 dark:bg-zinc-900">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
                  <tr>
                    <th className="px-5 py-3">Request #</th>
                    <th className="px-5 py-3">Vendor</th>
                    <th className="px-5 py-3 text-right">Amount</th>
                    <th className="px-5 py-3">Due date</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b border-zinc-100 last:border-b-0 dark:border-zinc-800">
                      <td className="px-5 py-3 font-mono text-xs">{r.request_number}</td>
                      <td className="px-5 py-3">{r.vendor?.name ?? "—"}</td>
                      <td className="px-5 py-3 text-right font-medium tabular-nums">{formatINR(r.payment_amount)}</td>
                      <td className="px-5 py-3 text-zinc-500">{r.payment_due_date}</td>
                      <td className="px-5 py-3"><StatusPill status={r.status} /></td>
                      <td className="px-5 py-3 text-right">
                        <Link href={`/requests/${r.id}`} className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400">Open →</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
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
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${color}`}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}
