import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUserRoles } from "@/lib/auth";
import PageHeader from "@/components/PageHeader";
import AccountsList, { type AccountsRow } from "./accounts-list";
import { formatINR, shortRequestNumber } from "@/lib/types";

type Row = {
  id: string;
  installment_number: number;
  requested_amount: number;
  payment_due_date: string;
  status: string;
  queued_for_upload_at: string | null;
  request: {
    id: string;
    request_number: string;
    title: string | null;
    vendor: { name: string; status: string; bank_account_number: string | null; bank_ifsc: string | null } | null;
  } | null;
  submitter: { full_name: string } | null;
};

// Filter tab → statuses. "all" = the live work queue (default);
// "closed" adds a history view.
//
// Approved and To upload are the same status — an approved installment only
// reaches the bank file once Accounts queue it (migration 027) — so they're
// split by `queued` below rather than by status.
const TAB_STATUSES: Record<string, string[]> = {
  all: ["approved", "uploaded_in_bank", "invoice_pending", "payment_processed"],
  approved: ["approved"],
  to_upload: ["approved"],
  in_bank: ["uploaded_in_bank"],
  invoice_pending: ["invoice_pending"],
  to_close: ["payment_processed"],
  closed: ["closed"],
};

/** null = no extra filter; true/false = only queued / only not-yet-queued. */
const TAB_QUEUED: Record<string, boolean | null> = {
  all: null, approved: false, to_upload: true,
  in_bank: null, invoice_pending: null, to_close: null, closed: null,
};

export default async function AccountsQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; bankfile?: string }>;
}) {
  const { roles } = await getCurrentUserRoles();
  if (!roles.includes("accounts") && !roles.includes("admin")) redirect("/dashboard");

  const { tab: tabRaw, bankfile } = await searchParams;
  const tab = TAB_STATUSES[tabRaw ?? ""] ? (tabRaw as string) : "all";

  const supabase = await createClient();
  let listQuery = supabase
    .from("request_installments")
    .select(
      `id, installment_number, requested_amount, payment_due_date, status, queued_for_upload_at,
       request:payment_requests!inner(id, request_number, title,
         vendor:vendors(name, status, bank_account_number, bank_ifsc)),
       submitter:profiles!request_installments_submitted_by_fkey(full_name)`,
    )
    .in("status", TAB_STATUSES[tab])
    .order("payment_due_date")
    .limit(200);

  const wantQueued = TAB_QUEUED[tab];
  if (wantQueued === true) listQuery = listQuery.not("queued_for_upload_at", "is", null);
  if (wantQueued === false) listQuery = listQuery.is("queued_for_upload_at", null);
  const { data } = await listQuery;

  // What a bank file would pick up right now: approved installments whose
  // vendor is approved AND has account number + IFSC. Anything else is
  // reported so nobody assumes it was paid.
  const { data: readyRaw } = await supabase
    .from("request_installments")
    .select(
      `id, requested_amount,
       request:payment_requests!inner(vendor:vendors(status, bank_account_number, bank_ifsc))`,
    )
    .eq("status", "approved")
    .not("queued_for_upload_at", "is", null)
    .limit(500);
  type ReadyRow = {
    requested_amount: number;
    request: { vendor: { status: string; bank_account_number: string | null; bank_ifsc: string | null } | null };
  };
  const readyRows = (readyRaw ?? []) as unknown as ReadyRow[];
  const payable = readyRows.filter(
    (r) =>
      r.request.vendor?.status === "approved" &&
      !!r.request.vendor?.bank_account_number &&
      !!r.request.vendor?.bank_ifsc,
  );
  const bankReadyCount = payable.length;
  const bankReadyTotal = payable.reduce((s, r) => s + Number(r.requested_amount), 0);
  const bankBlockedCount = readyRows.length - payable.length;

  const rows: AccountsRow[] = ((data ?? []) as unknown as Row[]).map((r) => ({
    id: r.id,
    threadId: r.request?.id ?? "",
    label: `${shortRequestNumber(r.request?.request_number) || "—"} · #${r.installment_number}`,
    requestTitle: r.request?.title ?? "",
    vendorName: r.request?.vendor?.name ?? "—",
    submitterName: r.submitter?.full_name ?? "—",
    amount: Number(r.requested_amount),
    dueDate: r.payment_due_date,
    status: r.status,
    queued: !!r.queued_for_upload_at,
    // Can't go in a bank file: no account/IFSC, or the vendor was rejected
    // after this was approved.
    notPayable:
      r.status === "approved" &&
      !(
        r.request?.vendor?.status === "approved" &&
        !!r.request?.vendor?.bank_account_number &&
        !!r.request?.vendor?.bank_ifsc
      ),
  }));

  const tabs = [
    { key: "all", label: "All open" },
    { key: "approved", label: "Approved" },
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
        subtitle="Every approved installment that needs processing, in due-date order. Queue the ones you want in the next bank file."
      />

      {bankfile && <BankFileNotice reason={bankfile} />}

      {/* Kotak bulk-payment file */}
      <section className="mt-5 flex flex-col gap-3 rounded-2xl border border-indigo-200 bg-indigo-50/60 p-4 sm:flex-row sm:items-center sm:justify-between dark:border-indigo-900 dark:bg-indigo-950/30">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-indigo-900 dark:text-indigo-200">
            Kotak bulk payment file
          </h2>
          <p className="mt-0.5 text-xs text-indigo-900/80 dark:text-indigo-200/80">
            {bankReadyCount === 0
              ? "Nothing queued. Pick payments on the Approved tab to build the next file."
              : `${bankReadyCount} payment${bankReadyCount === 1 ? "" : "s"} queued · ${formatINR(bankReadyTotal)} — downloading marks them as uploaded in bank.`}
            {bankBlockedCount > 0 &&
              ` ${bankBlockedCount} held back: vendor not approved or bank details missing.`}
          </p>
        </div>
        <form action="/api/bank-file" method="post" className="shrink-0">
          <button
            type="submit"
            disabled={bankReadyCount === 0}
            className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 sm:w-auto"
          >
            Download bank file (.xls)
          </button>
        </form>
      </section>

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

      <AccountsList rows={rows} tab={tab} />
    </div>
  );
}

function BankFileNotice({ reason }: { reason: string }) {
  const MESSAGES: Record<string, string> = {
    empty: "Nothing to download — no approved payment has a vendor with complete bank details.",
    noaccount: "The Kotak debit account isn't configured yet. An admin needs to set KOTAK_DEBIT_ACCOUNT in Vercel and redeploy.",
    forbidden: "You don't have permission to generate the bank file.",
    failed: "Couldn't build the bank file. Try again.",
    signin: "Your session expired — sign in and try again.",
  };
  return (
    <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
      {MESSAGES[reason] ?? "Couldn't generate the bank file."}
    </p>
  );
}
