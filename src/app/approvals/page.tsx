import Link from "next/link";
import { redirect } from "next/navigation";
import { formatISTDate, shortRequestNumber } from "@/lib/types";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUserRoles } from "@/lib/auth";
import PageHeader from "@/components/PageHeader";
import ApprovalsList, { type ApprovalRow } from "./approvals-list";

type Row = {
  id: string;
  installment_number: number;
  requested_amount: number;
  submitted_at: string;
  status: string;
  approved_at: string | null;
  request: {
    id: string;
    request_number: string;
    title: string | null;
    vendor: { name: string; status: string } | null;
    comments: {
      id: string;
      created_at: string;
      author_id: string;
      comment_mentions: { mentioned_user_id: string }[];
    }[];
  } | null;
  submitter: { full_name: string } | null;
  approver: { full_name: string } | null;
};

// Tab → set of installment statuses it shows. Same buckets as My Requests.
const TAB_STATUSES: Record<string, string[]> = {
  all: [
    "pending_approval", "clarification_required", "approved", "uploaded_in_bank",
    "invoice_pending", "payment_processed", "closed", "rejected",
    "returned_for_correction", "cancelled",
  ],
  waiting: ["pending_approval", "clarification_required"],
  approved: ["approved", "uploaded_in_bank"],
  paid: ["invoice_pending", "payment_processed"],
  rejected: ["rejected", "returned_for_correction", "cancelled"],
  closed: ["closed"],
};

export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { user, roles } = await getCurrentUserRoles();
  if (!roles.includes("approver") && !roles.includes("admin")) redirect("/dashboard");

  const { tab: tabRaw } = await searchParams;
  const tab = TAB_STATUSES[tabRaw ?? ""] ? (tabRaw as string) : "waiting";

  const supabase = await createClient();
  const [{ data }, readsRes, waitingCountRes] = await Promise.all([
    supabase
      .from("request_installments")
      .select(
        `id, installment_number, requested_amount, submitted_at, status, approved_at,
         request:payment_requests!inner(id, request_number, title,
           vendor:vendors(name, status),
           comments(id, created_at, author_id, comment_mentions(mentioned_user_id))),
         submitter:profiles!request_installments_submitted_by_fkey(full_name),
         approver:profiles!request_installments_approver_id_fkey(full_name)`,
      )
      .in("status", TAB_STATUSES[tab])
      .order("submitted_at", { ascending: false })
      .limit(100),
    supabase.from("request_reads").select("request_id, last_read_at").eq("user_id", user!.id),
    supabase
      .from("request_installments")
      .select("id", { count: "exact", head: true })
      .in("status", TAB_STATUSES.waiting),
  ]);
  const waitingCount = waitingCountRes.count ?? 0;

  const lastReadByThread = new Map(
    ((readsRes.data ?? []) as { request_id: string; last_read_at: string }[]).map((r) => [
      r.request_id,
      new Date(r.last_read_at).getTime(),
    ]),
  );

  const rows: ApprovalRow[] = ((data ?? []) as unknown as Row[]).map((r) => {
    const lastRead = r.request ? (lastReadByThread.get(r.request.id) ?? 0) : 0;
    const unread = (r.request?.comments ?? []).filter(
      (c) => c.author_id !== user!.id && new Date(c.created_at).getTime() > lastRead,
    );
    return {
      id: r.id,
      threadId: r.request?.id ?? "",
      label: `${shortRequestNumber(r.request?.request_number) || "—"} · #${r.installment_number}`,
      requestTitle: r.request?.title ?? "",
      vendorName: r.request?.vendor?.name ?? "—",
      vendorPending: r.request?.vendor?.status !== "approved",
      submitterName: r.submitter?.full_name ?? "—",
      approverName: r.approver?.full_name ?? null,
      approvedAt: r.approved_at,
      amount: Number(r.requested_amount),
      requestedAt: formatISTDate(r.submitted_at),
      status: r.status,
      unreadCount: unread.length,
      mentionedUnread: unread.some((c) =>
        (c.comment_mentions ?? []).some((m) => m.mentioned_user_id === user!.id),
      ),
    };
  });

  const tabs = [
    { key: "waiting", label: "Pending approval", badge: waitingCount },
    { key: "approved", label: "Approved" },
    { key: "paid", label: "Paid" },
    { key: "rejected", label: "Rejected" },
    { key: "closed", label: "Closed" },
    { key: "all", label: "All" },
  ] as const;

  return (
    <div>
      <PageHeader
        title="Approvals"
        subtitle={
          tab === "waiting"
            ? `${rows.length} installment${rows.length === 1 ? "" : "s"} waiting on any Approver to act.`
            : tab === "approved"
              ? "Approved — awaiting bank upload or payment confirmation."
              : tab === "paid"
                ? "Payment done — invoice pending or processed."
                : tab === "rejected"
                  ? "Rejected installments. Submitters can edit & resubmit these."
                  : tab === "closed"
                    ? "Fully closed installments."
                    : "Every installment, all statuses."
        }
      />

      <div className="mt-6 -mx-4 flex items-center gap-1 overflow-x-auto border-b border-zinc-200 px-4 sm:mx-0 sm:px-0 dark:border-zinc-800">
        {tabs.map((t) => {
          const active = tab === t.key;
          return (
            <Link
              key={t.key}
              href={`/approvals?tab=${t.key}`}
              className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm ${
                active
                  ? "border-indigo-600 font-medium text-indigo-700 dark:text-indigo-300"
                  : "border-transparent text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              }`}
            >
              {t.label}
              {"badge" in t && (t.badge ?? 0) > 0 && (
                <span className="ml-1 rounded-full bg-amber-100 px-1.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900 dark:text-amber-200">
                  {t.badge}
                </span>
              )}
            </Link>
          );
        })}
      </div>

      <ApprovalsList rows={rows} />
    </div>
  );
}
