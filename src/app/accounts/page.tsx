import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUserRoles } from "@/lib/auth";
import { formatINR } from "@/lib/types";
import PageHeader from "@/components/PageHeader";

type Row = {
  id: string;
  installment_number: number;
  requested_amount: number;
  payment_due_date: string;
  status: string;
  request: {
    id: string;
    request_number: string;
    vendor: { name: string; status: string } | null;
  } | null;
  submitter: { full_name: string } | null;
};

// Filter tab → statuses. "all" = the live work queue (default);
// "closed" adds a history view.
const TAB_STATUSES: Record<string, string[]> = {
  all: ["approved", "uploaded_in_bank", "invoice_pending", "payment_processed"],
  to_upload: ["approved"],
  in_bank: ["uploaded_in_bank"],
  invoice_pending: ["invoice_pending"],
  to_close: ["payment_processed"],
  closed: ["closed"],
};

export default async function AccountsQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { roles } = await getCurrentUserRoles();
  if (!roles.includes("accounts") && !roles.includes("admin")) redirect("/dashboard");

  const { tab: tabRaw } = await searchParams;
  const tab = TAB_STATUSES[tabRaw ?? ""] ? (tabRaw as string) : "all";

  const supabase = await createClient();
  const { data } = await supabase
    .from("request_installments")
    .select(
      `id, installment_number, requested_amount, payment_due_date, status,
       request:payment_requests!inner(id, request_number,
         vendor:vendors(name, status)),
       submitter:profiles!request_installments_submitted_by_fkey(full_name)`,
    )
    .in("status", TAB_STATUSES[tab])
    .order("payment_due_date")
    .limit(200);

  const rows = (data ?? []) as unknown as Row[];

  const buckets = [
    { key: "approved", title: "Approved → Ready to upload in bank" },
    { key: "uploaded_in_bank", title: "Uploaded in bank → Awaiting confirmation" },
    { key: "invoice_pending", title: "Paid → Invoice pending" },
    { key: "payment_processed", title: "Paid → Ready to close" },
    { key: "closed", title: "Closed" },
  ] as const;

  const tabs = [
    { key: "all", label: "All open" },
    { key: "to_upload", label: "To upload" },
    { key: "in_bank", label: "In bank" },
    { key: "invoice_pending", label: "Invoice pending" },
    { key: "to_close", label: "To close" },
    { key: "closed", label: "Closed" },
  ] as const;

  return (
    <div>
      <PageHeader
        title="Accounts work queue"
        subtitle="Every installment approved that needs processing, in due-date order."
      />

      {/* Filter tabs */}
      <div className="mt-6 -mx-4 flex items-center gap-1 overflow-x-auto border-b border-zinc-200 px-4 sm:mx-0 sm:px-0 dark:border-zinc-800">
        {tabs.map((t) => {
          const active = tab === t.key;
          return (
            <Link
              key={t.key}
              href={t.key === "all" ? "/accounts" : `/accounts?tab=${t.key}`}
              className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm ${
                active
                  ? "border-indigo-600 font-medium text-indigo-700 dark:text-indigo-300"
                  : "border-transparent text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </div>

      {rows.length === 0 && (
        <div className="mt-6 rounded-2xl border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
          Nothing here. Clean queue.
        </div>
      )}

      <div className="mt-8 space-y-8">
        {buckets.map((b) => {
          const bucket = rows.filter((r) => r.status === b.key);
          if (bucket.length === 0) return null;
          return (
            <section key={b.key}>
              <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                {b.title} <span className="text-zinc-500">({bucket.length})</span>
              </h2>

              {/* Mobile */}
              <ul className="mt-3 space-y-3 sm:hidden">
                {bucket.map((r) => (
                  <li key={r.id}>
                    <Link
                      href={`/requests/${r.request?.id}`}
                      className="block rounded-xl border border-zinc-200 bg-white p-4 active:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="font-mono text-[11px] text-zinc-500">
                            {r.request?.request_number} · #{r.installment_number}
                          </p>
                          <p className="mt-0.5 truncate text-base font-medium text-zinc-900 dark:text-zinc-100">{r.request?.vendor?.name}</p>
                          <p className="mt-0.5 truncate text-xs text-zinc-500">by {r.submitter?.full_name ?? "—"}</p>
                        </div>
                        <span className="shrink-0 text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                          {formatINR(r.requested_amount)}
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-zinc-500">Due {r.payment_due_date}</p>
                    </Link>
                  </li>
                ))}
              </ul>

              {/* Desktop */}
              <div className="mt-3 hidden overflow-hidden rounded-2xl border border-zinc-200 bg-white sm:block dark:border-zinc-800 dark:bg-zinc-900">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <tbody>
                      {bucket.map((r) => (
                        <tr key={r.id} className="border-b border-zinc-100 last:border-b-0 dark:border-zinc-800">
                          <td className="px-5 py-2 font-mono text-xs">
                            {r.request?.request_number} · #{r.installment_number}
                          </td>
                          <td className="px-5 py-2">{r.request?.vendor?.name}</td>
                          <td className="px-5 py-2 text-zinc-500">{r.submitter?.full_name ?? "—"}</td>
                          <td className="px-5 py-2 text-right tabular-nums">{formatINR(r.requested_amount)}</td>
                          <td className="px-5 py-2 text-zinc-500">{r.payment_due_date}</td>
                          <td className="px-5 py-2 text-right">
                            <Link href={`/requests/${r.request?.id}`} className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400">View →</Link>
                          </td>
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
