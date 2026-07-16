import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUserRoles } from "@/lib/auth";
import { STATUS_LABEL, formatINR } from "@/lib/types";
import PageHeader from "@/components/PageHeader";

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
      <PageHeader
        title="Approvals"
        subtitle={`${rows.length} request${rows.length === 1 ? "" : "s"} waiting on any Approver to act.`}
      />

      {rows.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
          Nothing waiting on your decision. Clean queue.
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
                        {r.vendor?.name}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-zinc-500">by {r.submitter?.full_name ?? "—"}</p>
                    </div>
                    <StatusPill status={r.status} />
                  </div>
                  <div className="mt-2 flex items-baseline justify-between text-xs">
                    <span className="font-semibold text-zinc-900 tabular-nums dark:text-zinc-100">
                      {formatINR(r.payment_amount)}
                    </span>
                    <span className="text-zinc-500">Due {r.payment_due_date}</span>
                  </div>
                  {r.vendor?.status !== "approved" && (
                    <p className="mt-2 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900 dark:text-amber-200">
                      vendor pending
                    </p>
                  )}
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
                    <th className="px-5 py-3">Raised by</th>
                    <th className="px-5 py-3 text-right">Amount</th>
                    <th className="px-5 py-3">Due</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
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
                      <td className="px-5 py-3"><StatusPill status={r.status} /></td>
                      <td className="px-5 py-3 text-right">
                        <Link href={`/requests/${r.id}`} className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400">Review →</Link>
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
    status === "clarification_required"
      ? "bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-200"
      : "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-200";
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${color}`}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}
