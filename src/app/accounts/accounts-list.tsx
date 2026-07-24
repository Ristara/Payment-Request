"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatINR } from "@/lib/types";
import { SearchBox } from "@/app/approvals/approvals-list";

export type AccountsRow = {
  id: string;
  threadId: string;
  label: string;
  requestTitle: string;
  vendorName: string;
  submitterName: string;
  amount: number;
  dueDate: string;
  status: string;
};

const BUCKETS = [
  { key: "approved", title: "Approved → Ready to upload in bank" },
  { key: "uploaded_in_bank", title: "Uploaded in bank → Awaiting confirmation" },
  { key: "invoice_pending", title: "Paid → Invoice pending" },
  { key: "payment_processed", title: "Paid → Ready to close" },
  { key: "closed", title: "Closed" },
] as const;

/** Bucketed accounts queue with live search over #, vendor, raised-by. */
export default function AccountsList({ rows }: { rows: AccountsRow[] }) {
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(
      (r) =>
        r.label.toLowerCase().includes(needle) ||
        r.requestTitle.toLowerCase().includes(needle) ||
        r.vendorName.toLowerCase().includes(needle) ||
        r.submitterName.toLowerCase().includes(needle),
    );
  }, [rows, q]);

  return (
    <div>
      <SearchBox q={q} setQ={setQ} placeholder="Search request #, title, vendor, raised by…" />
      {q && (
        <p className="mt-2 text-xs text-zinc-500">
          {filtered.length} match{filtered.length === 1 ? "" : "es"}
        </p>
      )}

      {filtered.length === 0 && (
        <div className="mt-4 rounded-2xl border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
          {q ? `No matches for "${q}".` : "Nothing here. Clean queue."}
        </div>
      )}

      <div className="mt-4 space-y-8">
        {BUCKETS.map((b) => {
          const bucket = filtered.filter((r) => r.status === b.key);
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
                      href={`/requests/${r.threadId}`}
                      className="block rounded-xl border border-zinc-200 bg-white p-4 active:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="font-mono text-[11px] text-zinc-500">{r.label}</p>
                          <p className="mt-0.5 truncate text-base font-medium text-zinc-900 dark:text-zinc-100">
                            {r.requestTitle || r.vendorName}
                          </p>
                          <p className="mt-0.5 truncate text-xs text-zinc-500">
                            {r.requestTitle ? `${r.vendorName} · ` : ""}by {r.submitterName}
                          </p>
                        </div>
                        <span className="shrink-0 text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                          {formatINR(r.amount)}
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-zinc-500">Due {r.dueDate}</p>
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
                            <Link
                              href={`/requests/${r.threadId}`}
                              className="font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                            >
                              {r.label}
                            </Link>
                          </td>
                          <td className="px-5 py-2">
                            {r.requestTitle ? (
                              <>
                                <div className="font-medium text-zinc-900 dark:text-zinc-100">{r.requestTitle}</div>
                                <div className="text-xs text-zinc-500">{r.vendorName}</div>
                              </>
                            ) : (
                              r.vendorName
                            )}
                          </td>
                          <td className="px-5 py-2 text-zinc-500">{r.submitterName}</td>
                          <td className="px-5 py-2 text-right tabular-nums">{formatINR(r.amount)}</td>
                          <td className="px-5 py-2 text-zinc-500">{r.dueDate}</td>
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
