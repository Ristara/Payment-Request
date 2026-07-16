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
  vendor: { name: string; status: string } | null;
  submitter: { full_name: string } | null;
};

export default async function AccountsQueuePage() {
  const { roles } = await getCurrentUserRoles();
  if (!roles.includes("accounts") && !roles.includes("admin")) redirect("/dashboard");

  const supabase = await createClient();
  const { data } = await supabase
    .from("payment_requests")
    .select(
      `id, request_number, status, payment_amount, payment_due_date,
       vendor:vendors(name, status),
       submitter:profiles!payment_requests_submitter_id_fkey(full_name)`,
    )
    .in("status", ["approved", "uploaded_in_bank", "invoice_pending", "payment_processed"])
    .order("payment_due_date");

  const rows = (data ?? []) as unknown as Row[];

  const buckets = [
    { key: "approved", title: "Approved → Ready to upload in bank" },
    { key: "uploaded_in_bank", title: "Uploaded in bank → Awaiting confirmation" },
    { key: "invoice_pending", title: "Paid → Invoice pending" },
    { key: "payment_processed", title: "Paid → Ready to close" },
  ] as const;

  return (
    <div>
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Accounts work queue</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Everything approved that needs processing, in due-date order.
      </p>

      <div className="mt-8 space-y-8">
        {buckets.map((b) => {
          const bucket = rows.filter((r) => r.status === b.key);
          return (
            <section key={b.key}>
              <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                {b.title} <span className="text-zinc-500">({bucket.length})</span>
              </h2>
              {bucket.length > 0 && (
                <div className="mt-3 overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
                  <table className="w-full text-sm">
                    <thead className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
                      <tr>
                        <th className="px-5 py-2">Request #</th>
                        <th className="px-5 py-2">Vendor</th>
                        <th className="px-5 py-2">Raised by</th>
                        <th className="px-5 py-2 text-right">Amount</th>
                        <th className="px-5 py-2">Due</th>
                        <th className="px-5 py-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {bucket.map((r) => (
                        <tr key={r.id} className="border-b border-zinc-100 last:border-b-0 dark:border-zinc-800">
                          <td className="px-5 py-2 font-mono text-xs">{r.request_number}</td>
                          <td className="px-5 py-2">{r.vendor?.name}</td>
                          <td className="px-5 py-2 text-zinc-500">{r.submitter?.full_name ?? "—"}</td>
                          <td className="px-5 py-2 text-right tabular-nums">{formatINR(r.payment_amount)}</td>
                          <td className="px-5 py-2 text-zinc-500">{r.payment_due_date}</td>
                          <td className="px-5 py-2 text-right">
                            <Link href={`/requests/${r.id}`} className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                              Open →
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
