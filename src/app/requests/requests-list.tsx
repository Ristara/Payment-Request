"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { STATUS_LABEL, formatINR } from "@/lib/types";
import { SearchBox } from "@/app/approvals/approvals-list";

export type RequestsRow = {
  id: string;
  requestNumber: string;
  requestTitle: string;
  vendorName: string;
  poValue: number;
  requestedTotal: number;
  installmentCount: number;
  latestStatus: string;
  latestDue: string | null;
  unreadCount: number;
  mentionedUnread: boolean;
  isCc: boolean;
};

/** My Requests list with live search over request # and vendor. */
export default function RequestsList({ rows }: { rows: RequestsRow[] }) {
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(
      (r) =>
        r.requestNumber.toLowerCase().includes(needle) ||
        r.requestTitle.toLowerCase().includes(needle) ||
        r.vendorName.toLowerCase().includes(needle),
    );
  }, [rows, q]);

  return (
    <div>
      <SearchBox q={q} setQ={setQ} placeholder="Search request #, title or vendor…" />
      {q && (
        <p className="mt-2 text-xs text-zinc-500">
          {filtered.length} match{filtered.length === 1 ? "" : "es"}
        </p>
      )}

      {filtered.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
          {q ? `No matches for "${q}".` : "Nothing here."}
        </div>
      ) : (
        <>
          {/* Mobile card list */}
          <ul className="mt-4 space-y-3 sm:hidden">
            {filtered.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/requests/${r.id}`}
                  className="block rounded-xl border border-zinc-200 bg-white p-4 active:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-[11px] text-zinc-500">
                        {r.requestNumber}
                        {r.isCc && (
                          <span className="ml-1.5 rounded bg-zinc-200 px-1 py-0.5 font-sans text-[9px] font-semibold uppercase text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
                            CC
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 truncate text-base font-medium text-zinc-900 dark:text-zinc-100">
                        {r.requestTitle || r.vendorName}
                      </p>
                      {r.requestTitle && (
                        <p className="truncate text-xs text-zinc-500">{r.vendorName}</p>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <StatusPill status={r.latestStatus} />
                      <DiscussionBadges unreadCount={r.unreadCount} mentioned={r.mentionedUnread} />
                    </div>
                  </div>
                  <div className="mt-2 flex items-baseline justify-between text-xs">
                    <span className="font-semibold text-zinc-900 tabular-nums dark:text-zinc-100">
                      PO {formatINR(r.poValue)}
                    </span>
                    <span className="text-zinc-500">
                      {r.installmentCount} inst · {r.latestDue ? `Due ${r.latestDue}` : ""}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>

          {/* Desktop table */}
          <section className="mt-4 hidden rounded-2xl border border-zinc-200 bg-white sm:block dark:border-zinc-800 dark:bg-zinc-900">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
                  <tr>
                    <th className="px-5 py-3">Request #</th>
                    <th className="px-5 py-3">Title / Vendor</th>
                    <th className="px-5 py-3 text-right">PO value</th>
                    <th className="px-5 py-3 text-right">Requested</th>
                    <th className="px-5 py-3">Installments</th>
                    <th className="px-5 py-3">Latest status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={r.id} className="border-b border-zinc-100 last:border-b-0 dark:border-zinc-800">
                      <td className="px-5 py-3 font-mono text-xs">
                        <span className="inline-flex items-center gap-2">
                          <Link
                            href={`/requests/${r.id}`}
                            className="font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                          >
                            {r.requestNumber}
                          </Link>
                          {r.isCc && (
                            <span className="rounded bg-zinc-200 px-1 py-0.5 font-sans text-[9px] font-semibold uppercase text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
                              CC
                            </span>
                          )}
                          <DiscussionBadges unreadCount={r.unreadCount} mentioned={r.mentionedUnread} />
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        {r.requestTitle ? (
                          <>
                            <div className="font-medium text-zinc-900 dark:text-zinc-100">{r.requestTitle}</div>
                            <div className="text-xs text-zinc-500">{r.vendorName}</div>
                          </>
                        ) : (
                          r.vendorName
                        )}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums">{formatINR(r.poValue)}</td>
                      <td className="px-5 py-3 text-right tabular-nums text-zinc-600">{formatINR(r.requestedTotal)}</td>
                      <td className="px-5 py-3 text-zinc-500">{r.installmentCount}</td>
                      <td className="px-5 py-3"><StatusPill status={r.latestStatus} /></td>
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
    status === "closed" || status === "payment_processed"
      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200"
      : status === "rejected" || status === "cancelled"
        ? "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-200"
        : status === "returned_for_correction" || status === "clarification_required"
          ? "bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-200"
          : status === "approved" || status === "uploaded_in_bank" || status === "invoice_pending"
            ? "bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-200"
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
