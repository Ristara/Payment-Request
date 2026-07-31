"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { formatINR, formatISTDate } from "@/lib/types";
import { SearchBox } from "@/app/approvals/approvals-list";
import { queueForBankUpload } from "@/app/requests/actions";

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
  notPayable: boolean;
  /** Accounts have picked this for the next bank file. */
  queued: boolean;
  /** Withheld by Accounts; the bank is paid amount - tds. */
  tds: number;
};

export type SelectMode = "queue" | "unqueue" | "recall";

/** Which bucket each mode acts on, and how its button reads. */
const SELECT_BUCKET: Record<SelectMode, string> = {
  queue: "approved",
  unqueue: "approved",
  recall: "uploaded_in_bank",
};
const SELECT_LABEL: Record<SelectMode, string> = {
  queue: "Move to To upload",
  unqueue: "Move back to Approved",
  recall: "Move back to To upload",
};

const BUCKETS = [
  { key: "approved", title: "Approved → Pick what goes in the next bank file" },
  { key: "uploaded_in_bank", title: "Uploaded in bank → Awaiting confirmation" },
  { key: "invoice_pending", title: "Paid → Invoice pending" },
  { key: "payment_processed", title: "Paid → Ready to close" },
  { key: "closed", title: "Closed" },
] as const;

/** Bucketed accounts queue with live search over #, vendor, raised-by. */
export default function AccountsList({
  rows,
  tab,
  canAct,
}: {
  rows: AccountsRow[];
  tab: string;
  /** Only the Accounts role moves payments; an admin here is a spectator. */
  canAct: boolean;
}) {
  const [q, setQ] = useState("");
  // Each bank-file stage can push its rows one step back toward Approved.
  // Everywhere else the rows aren't a set you act on in bulk.
  const mode: SelectMode | null = !canAct
    ? null
    : tab === "approved" ? "queue" : tab === "to_upload" ? "unqueue" : tab === "in_bank" ? "recall" : null;
  const selectable = mode !== null;
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [state, action, pending] = useActionState(queueForBankUpload, undefined);

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

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
                {tab === "to_upload" && b.key === "approved"
                  ? "Queued → Goes in the next bank file"
                  : b.title}{" "}
                <span className="text-zinc-500">({bucket.length})</span>
              </h2>

              {mode && SELECT_BUCKET[mode] === b.key && (
                <SelectionBar
                  bucket={bucket}
                  picked={picked}
                  setPicked={setPicked}
                  action={action}
                  pending={pending}
                  state={state}
                  mode={mode}
                />
              )}

              {/* Mobile */}
              <ul className="mt-3 space-y-3 sm:hidden">
                {bucket.map((r) => (
                  <li key={r.id} className="flex items-start gap-2">
                    {selectable && (
                      <input
                        type="checkbox"
                        checked={picked.has(r.id)}
                        onChange={() => toggle(r.id)}
                        aria-label={`Select ${r.label}`}
                        className="mt-5 h-4 w-4 shrink-0"
                      />
                    )}
                    <Link
                      href={`/requests/${r.threadId}`}
                      className="block flex-1 rounded-xl border border-zinc-200 bg-white p-4 active:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900"
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
                          {r.notPayable && <NotPayableChip />}
                        </div>
                        <span className="shrink-0 text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                          {formatINR(r.amount)}
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-zinc-500">Due {formatISTDate(r.dueDate)}</p>
                      {r.tds > 0 && (
                        <p className="mt-1 text-xs text-zinc-500">
                          TDS {formatINR(r.tds)} · Net{" "}
                          <span className="font-medium text-zinc-700 dark:text-zinc-300">
                            {formatINR(r.amount - r.tds)}
                          </span>
                        </p>
                      )}
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
                          {selectable && (
                            <td className="pl-5 py-2">
                              <input
                                type="checkbox"
                                checked={picked.has(r.id)}
                                onChange={() => toggle(r.id)}
                                aria-label={`Select ${r.label}`}
                                className="h-4 w-4"
                              />
                            </td>
                          )}
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
                          <td className="px-5 py-2 text-zinc-500">
                            {r.submitterName}
                            {r.notPayable && <NotPayableChip />}
                          </td>
                          <td className="px-5 py-2 text-right tabular-nums">{formatINR(r.amount)}</td>
                          {/* Read-only: TDS is set on the request page. */}
                          {r.tds > 0 && (
                            <td className="px-2 py-2 text-right text-xs text-zinc-500">
                              <div>TDS {formatINR(r.tds)}</div>
                              <div className="font-medium text-zinc-700 dark:text-zinc-300">
                                Net {formatINR(r.amount - r.tds)}
                              </div>
                            </td>
                          )}
                          <td className="px-5 py-2 text-zinc-500">{formatISTDate(r.dueDate)}</td>
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

/** Approved, but the bank file can't take it — vendor details incomplete. */
function NotPayableChip() {
  return (
    <span
      title="Vendor has no account number / IFSC, or is no longer approved — this is left out of the bank file"
      className="ml-1.5 inline-block rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/60 dark:text-amber-200"
    >
      bank details missing
    </span>
  );
}

/**
 * Bulk move between Approved and To upload.
 *
 * The ids go in the form itself rather than through a client fetch, so the
 * server action re-reads and re-checks each one — the page may have been open
 * a while, and a vendor can lose its approval in that time.
 */
function SelectionBar({
  bucket,
  picked,
  setPicked,
  action,
  pending,
  state,
  mode,
}: {
  bucket: AccountsRow[];
  picked: Set<string>;
  setPicked: (v: Set<string>) => void;
  action: (formData: FormData) => void;
  pending: boolean;
  state: { error?: string; info?: string } | undefined;
  mode: SelectMode;
}) {
  // Selecting something the bank file would skip anyway is a dead end, so
  // "select all" takes only what can actually be paid. Only applies when
  // queuing — the other two directions move rows away from the file.
  const selectableRows = mode === "queue" ? bucket.filter((r) => !r.notPayable) : bucket;
  const ids = [...picked].filter((id) => bucket.some((r) => r.id === id));
  const allPicked = selectableRows.length > 0 && selectableRows.every((r) => picked.has(r.id));
  // Show what actually leaves the bank, not what was approved.
  const total = bucket
    .filter((r) => picked.has(r.id))
    .reduce((sum, r) => sum + Math.max(r.amount - r.tds, 0), 0);
  const withheldTotal = bucket
    .filter((r) => picked.has(r.id))
    .reduce((sum, r) => sum + r.tds, 0);

  return (
    <div className="mt-3 rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/60">
      <form action={action} className="flex flex-wrap items-center gap-3">
        {ids.map((id) => (
          <input key={id} type="hidden" name="installment_ids" value={id} />
        ))}
        <input type="hidden" name="action" value={mode} />

        <label className="flex items-center gap-2 text-xs font-medium text-zinc-700 dark:text-zinc-300">
          <input
            type="checkbox"
            checked={allPicked}
            onChange={() => setPicked(allPicked ? new Set() : new Set(selectableRows.map((r) => r.id)))}
            className="h-4 w-4"
          />
          Select all{mode === "queue" && selectableRows.length < bucket.length ? " payable" : ""}
        </label>

        <span className="text-xs text-zinc-500">
          {ids.length === 0
            ? "Nothing selected"
            : withheldTotal > 0
              ? `${ids.length} selected · ${formatINR(total)} to pay (TDS ${formatINR(withheldTotal)})`
              : `${ids.length} selected · ${formatINR(total)}`}
        </span>

        <button
          type="submit"
          disabled={pending || ids.length === 0}
          // Queuing is the forward action and reads as primary; the two
          // ways back are corrections, so they stay secondary.
          className={`ml-auto rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${
            mode === "queue"
              ? "bg-indigo-600 text-white hover:bg-indigo-700"
              : "border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
          }`}
        >
          {pending ? "Moving…" : `${SELECT_LABEL[mode]}${ids.length ? ` (${ids.length})` : ""}`}
        </button>
      </form>

      {state?.error && (
        <p className="mt-2 text-xs font-medium text-red-700 dark:text-red-300">{state.error}</p>
      )}
      {state?.info && (
        <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-300">{state.info}</p>
      )}
    </div>
  );
}
