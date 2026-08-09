import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUserRoles, requireUser } from "@/lib/auth";
import { formatINR, formatISTDate } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Procurement requests — everything someone has asked to be bought or fixed.
 *
 * RLS decides what lands here: the person who raised it sees their own, and
 * approvers, accounts, admin and procurement see all of them. No extra
 * filtering in this file, so the page cannot be more generous than the
 * database.
 */
const TAB_STATUSES: Record<string, string[]> = {
  open: ["pending_approval", "approved", "po_obtained"],
  pending_approval: ["pending_approval"],
  approved: ["approved"],
  po_obtained: ["po_obtained"],
  closed: ["closed"],
  rejected: ["rejected", "cancelled"],
};

const STATUS_LABEL: Record<string, string> = {
  pending_approval: "Pending approval",
  approved: "Needs a PO",
  po_obtained: "PO obtained",
  closed: "Closed",
  rejected: "Rejected",
  cancelled: "Withdrawn",
};

export default async function ProcurementPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  await requireUser();
  const { roles } = await getCurrentUserRoles();
  const { tab: tabRaw } = await searchParams;
  const tab = TAB_STATUSES[tabRaw ?? ""] ? (tabRaw as string) : "open";
  const canRaise = roles.includes("requester") || roles.includes("admin");

  const supabase = await createClient();
  const { data } = await supabase
    .from("procurement_requests")
    .select(
      `id, request_number, title, status, priority, created_at, po_reference,
       outlet:outlets(name),
       submitter:profiles!procurement_requests_submitter_id_fkey(full_name),
       lines:procurement_line_items(amount)`,
    )
    .in("status", TAB_STATUSES[tab])
    .order("created_at", { ascending: false })
    .limit(200);

  type Row = {
    id: string; request_number: string; title: string; status: string; priority: string;
    created_at: string; po_reference: string | null;
    outlet: { name: string } | { name: string }[] | null;
    submitter: { full_name: string } | { full_name: string }[] | null;
    lines: { amount: number }[] | null;
  };
  const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
  const rows = ((data ?? []) as unknown as Row[]).map((r) => ({
    ...r,
    outletName: one(r.outlet)?.name ?? "—",
    submitterName: one(r.submitter)?.full_name ?? "—",
    total: (r.lines ?? []).reduce((sum, l) => sum + Number(l.amount ?? 0), 0),
  }));

  const tabs = [
    { key: "open", label: "Open" },
    { key: "pending_approval", label: "Pending approval" },
    { key: "approved", label: "Needs a PO" },
    { key: "po_obtained", label: "PO obtained" },
    { key: "closed", label: "Closed" },
    { key: "rejected", label: "Rejected" },
  ] as const;

  return (
    <div>
      <PageHeader
        title="Procurement requests"
        subtitle="Something to be bought or repaired. Once a PO exists, a payment request is raised against it."
        action={canRaise ? { href: "/procurement/new", label: "Raise procurement request" } : undefined}
      />

      <div className="mt-6 -mx-4 flex items-center gap-1 overflow-x-auto border-b border-zinc-200 px-4 sm:mx-0 sm:px-0 dark:border-zinc-800">
        {tabs.map((t) => {
          const active = tab === t.key;
          return (
            <Link
              key={t.key}
              href={`/procurement?tab=${t.key}`}
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

      {rows.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
          Nothing here.
        </div>
      ) : (
        <ul className="mt-4 space-y-3">
          {rows.map((r) => (
            <li key={r.id}>
              <Link
                href={`/procurement/${r.id}`}
                className="block rounded-xl border border-zinc-200 bg-white p-4 hover:border-indigo-300 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-indigo-700"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 font-mono text-[11px] text-zinc-500">
                      {r.request_number}
                      {r.priority === "urgent" && (
                        <span className="rounded-full bg-red-100 px-1.5 py-0.5 font-sans text-[10px] font-semibold text-red-700 dark:bg-red-950 dark:text-red-200">
                          Urgent
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 truncate text-base font-medium text-zinc-900 dark:text-zinc-100">
                      {r.title}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-zinc-500">
                      {r.outletName} · by {r.submitterName} · {formatISTDate(r.created_at)}
                      {r.po_reference ? ` · PO ${r.po_reference}` : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                      {STATUS_LABEL[r.status] ?? r.status}
                    </span>
                    {r.total > 0 && (
                      <p className="mt-1 text-xs tabular-nums text-zinc-500">
                        {formatINR(r.total)}
                      </p>
                    )}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
