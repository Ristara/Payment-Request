import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUserRoles } from "@/lib/auth";
import { STATUS_LABEL, formatINR } from "@/lib/types";

type Row = {
  id: string;
  request_number: string;
  status: string;
  payment_amount: number;
  payment_due_date: string;
  created_at: string;
  vendor: { name: string; status: string } | null;
  submitter: { full_name: string } | null;
};

export default async function ApprovalsPage() {
  const { roles } = await getCurrentUserRoles();
  if (!roles.includes("approver") && !roles.includes("admin")) redirect("/dashboard");

  const supabase = await createClient();
  const { data } = await supabase
    .from("payment_requests")
    .select(
      `id, request_number, status, payment_amount, payment_due_date, created_at,
       vendor:vendors(name, status),
       submitter:profiles!payment_requests_submitter_id_fkey(full_name)`,
    )
    .in("status", ["pending_approval", "clarification_required"])
    .order("payment_due_date");

  const rows = (data ?? []) as unknown as Row[];

  return (
    <div>
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Approvals</h1>
      <p className="mt-1 text-sm text-zinc-500">
        {rows.length} request{rows.length === 1 ? "" : "s"} waiting on any Approver to act.
      </p>

      <section className="mt-8 rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <table className="w-full text-sm">
          <thead className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
            <tr>
              <th className="px-5 py-3">Request #</th>
              <th className="px-5 py-3">Vendor</th>
              <th className="px-5 py-3">Raised by</th>
              <th className="px-5 py-3 text-right">Amount</th>
              <th className="px-5 py-3">Due</th>
              <th className="px-5 py-3">Status</th>
              <th className="px-5 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-5 py-12 text-center text-sm text-zinc-500">
                  Nothing waiting on your decision. Clean queue.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-b border-zinc-100 last:border-b-0 dark:border-zinc-800">
                  <td className="px-5 py-3 font-mono text-xs">{r.request_number}</td>
                  <td className="px-5 py-3">
                    {r.vendor?.name}
                    {r.vendor?.status !== "approved" && (
                      <span className="ml-2 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900 dark:text-amber-200">
                        vendor pending
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-zinc-500">{r.submitter?.full_name ?? "—"}</td>
                  <td className="px-5 py-3 text-right font-medium tabular-nums">{formatINR(r.payment_amount)}</td>
                  <td className="px-5 py-3 text-zinc-500">{r.payment_due_date}</td>
                  <td className="px-5 py-3">
                    <StatusPill status={r.status} />
                  </td>
                  <td className="px-5 py-3 text-right">
                    <Link href={`/requests/${r.id}`} className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                      Review →
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
    status === "clarification_required"
      ? "bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-200"
      : "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-200";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${color}`}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}
