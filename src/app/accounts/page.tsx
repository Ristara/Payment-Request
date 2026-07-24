import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUserRoles } from "@/lib/auth";
import PageHeader from "@/components/PageHeader";
import AccountsList, { type AccountsRow } from "./accounts-list";

type Row = {
  id: string;
  installment_number: number;
  requested_amount: number;
  payment_due_date: string;
  status: string;
  request: {
    id: string;
    request_number: string;
    title: string | null;
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
       request:payment_requests!inner(id, request_number, title,
         vendor:vendors(name, status)),
       submitter:profiles!request_installments_submitted_by_fkey(full_name)`,
    )
    .in("status", TAB_STATUSES[tab])
    .order("payment_due_date")
    .limit(200);

  const rows: AccountsRow[] = ((data ?? []) as unknown as Row[]).map((r) => ({
    id: r.id,
    threadId: r.request?.id ?? "",
    label: `${r.request?.request_number ?? "—"} · #${r.installment_number}`,
    requestTitle: r.request?.title ?? "",
    vendorName: r.request?.vendor?.name ?? "—",
    submitterName: r.submitter?.full_name ?? "—",
    amount: Number(r.requested_amount),
    dueDate: r.payment_due_date,
    status: r.status,
  }));

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

      <AccountsList rows={rows} />
    </div>
  );
}
