import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { STATUS_LABEL, formatINR } from "@/lib/types";

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
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">My requests</h1>
          <p className="mt-1 text-sm text-zinc-500">Payment requests you have raised.</p>
        </div>
        <Link
          href="/requests/new"
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          + Raise request
        </Link>
      </div>

      <section className="mt-8 rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
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
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-5 py-12 text-center text-sm text-zinc-500">
                  No requests yet.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-b border-zinc-100 last:border-b-0 dark:border-zinc-800">
                  <td className="px-5 py-3 font-mono text-xs">{r.request_number}</td>
                  <td className="px-5 py-3">{r.vendor?.name ?? "—"}</td>
                  <td className="px-5 py-3 text-right font-medium tabular-nums">
                    {formatINR(r.payment_amount)}
                  </td>
                  <td className="px-5 py-3 text-zinc-500">{r.payment_due_date}</td>
                  <td className="px-5 py-3">
                    <StatusPill status={r.status} />
                  </td>
                  <td className="px-5 py-3 text-right">
                    <Link href={`/requests/${r.id}`} className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                      Open →
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
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
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${color}`}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}
