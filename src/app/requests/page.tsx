import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import PageHeader from "@/components/PageHeader";
import RequestFilters from "./request-filters";
import { getActiveOutlets } from "@/lib/masters";
import RequestsList, { type RequestsRow } from "./requests-list";
import { shortRequestNumber } from "@/lib/types";

type ThreadRow = {
  id: string;
  request_number: string;
  title: string | null;
  created_at: string;
  submitter_id: string;
  vendor: { name: string } | null;
  line_items: { amount: number }[];
  installments: {
    installment_number: number;
    status: string;
    requested_amount: number;
    payment_due_date: string;
  }[];
  comments: {
    id: string;
    created_at: string;
    author_id: string;
    comment_mentions: { mentioned_user_id: string }[];
  }[];
};

const PAGE_SIZE = 50;

// Filter tab → which latest-installment statuses a thread must be in.
const VIEW_FILTERS: Record<string, { label: string; statuses: string[] | null }> = {
  all: { label: "All", statuses: null },
  draft: { label: "Draft", statuses: ["draft"] },
  pending: { label: "Pending", statuses: ["pending_approval", "clarification_required"] },
  approved: { label: "Approved", statuses: ["approved", "uploaded_in_bank"] },
  paid: { label: "Paid", statuses: ["invoice_pending", "payment_processed"] },
  rejected: { label: "Rejected", statuses: ["rejected", "returned_for_correction", "cancelled"] },
  closed: { label: "Closed", statuses: ["closed"] },
};

export default async function MyRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string; view?: string;
    branch?: string; exp?: string; stage?: string; kind?: string;
  }>;
}) {
  const user = await requireUser();
  const {
    page: pageRaw, view: viewRaw,
    branch: branchRaw, exp: expRaw, stage: stageRaw, kind: kindRaw,
  } = await searchParams;
  // Whitelisted rather than passed straight through: these reach a query, and
  // a value nobody offered should narrow nothing rather than error the page.
  const branch = branchRaw || "";
  const exp = expRaw === "capex" || expRaw === "opex" ? expRaw : "";
  const stage = stageRaw === "upcoming" || stageRaw === "operational" ? stageRaw : "";
  const kind = kindRaw === "regular" || kindRaw === "milestone" ? kindRaw : "";
  const view = VIEW_FILTERS[viewRaw ?? ""] ? (viewRaw as string) : "all";
  const page = Math.max(0, Number(pageRaw) || 0);
  const supabase = await createClient();

  // Threads I'm CC'd on show alongside my own.
  const { data: watcherRows } = await supabase
    .from("request_watchers")
    .select("request_id")
    .eq("user_id", user.id);
  const watchedIds = ((watcherRows ?? []) as { request_id: string }[]).map((w) => w.request_id);
  const ownershipFilter =
    watchedIds.length > 0
      ? `submitter_id.eq.${user.id},id.in.(${watchedIds.join(",")})`
      : `submitter_id.eq.${user.id}`;

  let threadQuery = supabase
    .from("payment_requests")
    .select(
      `id, request_number, title, created_at, submitter_id,
       vendor:vendors(name),
       line_items:request_line_items(amount),
       installments:request_installments(installment_number, status, requested_amount, payment_due_date),
       comments(id, created_at, author_id, comment_mentions(mentioned_user_id))${
         branchRaw || stageRaw ? ", request_outlets!inner(outlet_id, outlet:outlets!inner(stage))" : ""
       }`,
      { count: "exact" },
    )
    .or(ownershipFilter)
    .order("created_at", { ascending: false });

  // Filtered in SQL, not in the browser. This list is paginated, so narrowing
  // the page in front of you would report a count for the page rather than the
  // result set — "3 results" when there are thirty.
  if (exp) threadQuery = threadQuery.eq("expense_type", exp);
  if (kind) threadQuery = threadQuery.eq("payment_kind", kind);
  if (branch) threadQuery = threadQuery.eq("request_outlets.outlet_id", branch);
  if (stage) threadQuery = threadQuery.eq("request_outlets.outlet.stage", stage);
  threadQuery =
    view === "all"
      ? threadQuery.range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
      : threadQuery.limit(200);

  const [{ data, count }, readsRes, outlets] = await Promise.all([
    threadQuery,
    supabase.from("request_reads").select("request_id, last_read_at").eq("user_id", user.id),
    getActiveOutlets(),
  ]);
  const rows = (data ?? []) as unknown as ThreadRow[];
  const totalPages = view === "all" ? Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE)) : 1;
  const lastReadByThread = new Map(
    ((readsRes.data ?? []) as { request_id: string; last_read_at: string }[]).map((r) => [
      r.request_id,
      new Date(r.last_read_at).getTime(),
    ]),
  );

  const summaryRows: RequestsRow[] = rows
    .map((r) => {
      const poValue = r.line_items.reduce((s, l) => s + Number(l.amount), 0);
      const insts = [...r.installments].sort((a, b) => a.installment_number - b.installment_number);
      const latest = insts[insts.length - 1];
      const requestedTotal = insts
        .filter((i) => !["cancelled", "rejected", "draft"].includes(i.status))
        .reduce((s, i) => s + Number(i.requested_amount), 0);

      const lastRead = lastReadByThread.get(r.id) ?? 0;
      const unread = (r.comments ?? []).filter(
        (c) => c.author_id !== user.id && new Date(c.created_at).getTime() > lastRead,
      );

      return {
        id: r.id,
        requestNumber: shortRequestNumber(r.request_number),
        requestTitle: r.title ?? "",
        vendorName: r.vendor?.name ?? "—",
        poValue,
        requestedTotal,
        installmentCount: insts.length,
        latestStatus: latest?.status ?? "draft",
        allStatuses: insts.map((i) => i.status),
        hasDraft: insts.some((i) => i.status === "draft"),
        latestDue: latest?.payment_due_date ?? null,
        unreadCount: unread.length,
        mentionedUnread: unread.some((c) =>
          (c.comment_mentions ?? []).some((m) => m.mentioned_user_id === user.id),
        ),
        isCc: r.submitter_id !== user.id,
      };
    })
    .filter((r) => {
      const allowed = VIEW_FILTERS[view].statuses;
      // Match on ANY installment so a recalled draft sitting behind a newer
      // installment still shows under its tab.
      return !allowed || r.allStatuses.some((st) => allowed.includes(st));
    });

  return (
    <div>
      <PageHeader title="My requests" subtitle="Payment threads you have raised." />

      {/* Status filter tabs */}
      <div className="mt-6 -mx-4 flex items-center gap-1 overflow-x-auto border-b border-zinc-200 px-4 sm:mx-0 sm:px-0 dark:border-zinc-800">
        {Object.entries(VIEW_FILTERS).map(([key, f]) => {
          const active = view === key;
          return (
            <Link
              key={key}
              href={key === "all" ? "/requests" : `/requests?view=${key}`}
              className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm ${
                active
                  ? "border-indigo-600 font-medium text-indigo-700 dark:text-indigo-300"
                  : "border-transparent text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              }`}
            >
              {f.label}
            </Link>
          );
        })}
      </div>

      <RequestFilters branches={(outlets as { id: string; name: string }[]).map((o) => ({ id: o.id, name: o.name }))} />

      {summaryRows.length === 0 && (branch || exp || stage || kind) ? (
        /* Named rather than a bare "no requests": an empty filtered list is
           otherwise indistinguishable from having raised nothing. */
        <div className="mt-4 rounded-2xl border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
          Nothing matches the filters you have on.
        </div>
      ) : summaryRows.length === 0 && view === "all" && !pageRaw ? (
        <div className="mt-6 rounded-2xl border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
          No requests yet.{" "}
          <Link href="/requests/new" className="text-indigo-600 underline">Raise your first</Link>.
        </div>
      ) : (
        <RequestsList rows={summaryRows} />
      )}

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-3 text-sm">
          {page > 0 && (
            <Link href={`/requests?page=${page - 1}`} className="text-indigo-600 hover:underline dark:text-indigo-400">
              ← Newer
            </Link>
          )}
          <span className="text-xs text-zinc-500">
            Page {page + 1} of {totalPages}
          </span>
          {page + 1 < totalPages && (
            <Link href={`/requests?page=${page + 1}`} className="text-indigo-600 hover:underline dark:text-indigo-400">
              Older →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
