import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUserRoles } from "@/lib/auth";
import { STATUS_LABEL, formatINR } from "@/lib/types";
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
    comments: {
      id: string;
      created_at: string;
      author_id: string;
      comment_mentions: { mentioned_user_id: string }[];
    }[];
  } | null;
  submitter: { full_name: string } | null;
};

export default async function ApprovalsPage() {
  const { user, roles } = await getCurrentUserRoles();
  if (!roles.includes("approver") && !roles.includes("admin")) redirect("/dashboard");

  const supabase = await createClient();
  const [{ data }, readsRes] = await Promise.all([
    supabase
      .from("request_installments")
      .select(
        `id, installment_number, requested_amount, payment_due_date, status,
         request:payment_requests!inner(id, request_number,
           vendor:vendors(name, status),
           comments(id, created_at, author_id, comment_mentions(mentioned_user_id))),
         submitter:profiles!request_installments_submitted_by_fkey(full_name)`,
      )
      .in("status", ["pending_approval", "clarification_required"])
      .order("payment_due_date"),
    supabase.from("request_reads").select("request_id, last_read_at").eq("user_id", user!.id),
  ]);

  const lastReadByThread = new Map(
    ((readsRes.data ?? []) as { request_id: string; last_read_at: string }[]).map((r) => [
      r.request_id,
      new Date(r.last_read_at).getTime(),
    ]),
  );

  const rows = ((data ?? []) as unknown as Row[]).map((r) => {
    const lastRead = r.request ? (lastReadByThread.get(r.request.id) ?? 0) : 0;
    const unread = (r.request?.comments ?? []).filter(
      (c) => c.author_id !== user!.id && new Date(c.created_at).getTime() > lastRead,
    );
    return {
      ...r,
      unreadCount: unread.length,
      mentionedUnread: unread.some((c) =>
        (c.comment_mentions ?? []).some((m) => m.mentioned_user_id === user!.id),
      ),
    };
  });

  return (
    <div>
      <PageHeader
        title="Approvals"
        subtitle={`${rows.length} installment${rows.length === 1 ? "" : "s"} waiting on any Approver to act.`}
      />

      {rows.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
          Nothing waiting on your decision. Clean queue.
        </div>
      ) : (
        <>
          {/* Mobile */}
          <ul className="mt-6 space-y-3 sm:hidden">
            {rows.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/requests/${r.request?.id}`}
                  className="block rounded-xl border border-zinc-200 bg-white p-4 active:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 font-mono text-[11px] text-zinc-500">
                        {r.request?.request_number} · #{r.installment_number}
                        <DiscussionBadges unreadCount={r.unreadCount} mentioned={r.mentionedUnread} />
                      </p>
                      <p className="mt-0.5 truncate text-base font-medium text-zinc-900 dark:text-zinc-100">
                        {r.request?.vendor?.name}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-zinc-500">by {r.submitter?.full_name ?? "—"}</p>
                    </div>
                    <StatusPill status={r.status} />
                  </div>
                  <div className="mt-2 flex items-baseline justify-between text-xs">
                    <span className="font-semibold text-zinc-900 tabular-nums dark:text-zinc-100">
                      {formatINR(r.requested_amount)}
                    </span>
                    <span className="text-zinc-500">Due {r.payment_due_date}</span>
                  </div>
                  {r.request?.vendor?.status !== "approved" && (
                    <p className="mt-2 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900 dark:text-amber-200">
                      vendor pending
                    </p>
                  )}
                </Link>
              </li>
            ))}
          </ul>

          {/* Desktop */}
          <section className="mt-6 hidden rounded-2xl border border-zinc-200 bg-white sm:block dark:border-zinc-800 dark:bg-zinc-900">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
                  <tr>
                    <th className="px-5 py-3">Thread · Installment</th>
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
                      <td className="px-5 py-3 font-mono text-xs">
                        <span className="inline-flex items-center gap-2">
                          {r.request?.request_number} · #{r.installment_number}
                          <DiscussionBadges unreadCount={r.unreadCount} mentioned={r.mentionedUnread} />
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        {r.request?.vendor?.name}
                        {r.request?.vendor?.status !== "approved" && (
                          <span className="ml-2 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900 dark:text-amber-200">
                            vendor pending
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-zinc-500">{r.submitter?.full_name ?? "—"}</td>
                      <td className="px-5 py-3 text-right font-medium tabular-nums">{formatINR(r.requested_amount)}</td>
                      <td className="px-5 py-3 text-zinc-500">{r.payment_due_date}</td>
                      <td className="px-5 py-3"><StatusPill status={r.status} /></td>
                      <td className="px-5 py-3 text-right">
                        <Link href={`/requests/${r.request?.id}`} className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400">Review →</Link>
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

function DiscussionBadges({ unreadCount, mentioned }: { unreadCount: number; mentioned: boolean }) {
  if (unreadCount === 0) return null;
  return (
    <span className="inline-flex items-center gap-1">
      <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-indigo-600 px-1.5 font-sans text-[10px] font-bold text-white">
        {unreadCount > 99 ? "99+" : unreadCount}
      </span>
      {mentioned && (
        <span className="inline-flex h-5 items-center rounded-full bg-amber-500 px-1.5 font-sans text-[10px] font-bold text-white">
          @ you
        </span>
      )}
    </span>
  );
}
