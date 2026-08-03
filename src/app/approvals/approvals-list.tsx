"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { STATUS_LABEL, formatINR } from "@/lib/types";
import { FilterPanel, FilterSelect, type ActiveChip } from "@/components/ListFilters";

// The same words the Raise form uses. An approver filtering by "New Store"
// should be picking the thing they watched someone choose when raising it —
// "upcoming" is the database's word, not the company's.
const EXPENSE_LABEL: Record<string, string> = { capex: "CapEx", opex: "OpEx" };
const KIND_LABEL: Record<string, string> = { regular: "Regular", milestone: "Milestone" };
const STAGE_LABEL: Record<string, string> = {
  upcoming: "New Store",
  operational: "Existing Outlet",
};

export type ApprovalRow = {
  id: string;
  threadId: string;
  label: string; // "PR-2026-00052 · #1"
  requestTitle: string;
  vendorName: string;
  vendorPending: boolean;
  submitterName: string;
  /** Every branch this request is raised against; a request may span several. */
  branches: string[];
  expenseType: string | null;
  paymentKind: string | null;
  /** Outlet stages: "upcoming" = New Store, "operational" = Existing Outlet. */
  stages: string[];
  approverName: string | null;
  approvedAt: string | null;
  amount: number;
  requestedAt: string; // ISO date of submission
  status: string;
  unreadCount: number;
  mentionedUnread: boolean;
};

/**
 * Client list with search and filters.
 *
 * Filtering here rather than in the query is correct for THIS page only: it
 * loads every installment for the tab, so the browser holds the whole set and
 * a count of matches is the truth. /requests is paginated and must filter in
 * SQL — narrowing one page there would report "3 results" out of thirty.
 *
 * Approvers triage by size and by who asked, which is why those two filters
 * are here and a due-date range is not.
 */
export default function ApprovalsList({ rows }: { rows: ApprovalRow[] }) {
  const [q, setQ] = useState("");
  const [raisedBy, setRaisedBy] = useState("");
  const [branch, setBranch] = useState("");
  const [expense, setExpense] = useState("");
  const [stage, setStage] = useState("");
  const [kind, setKind] = useState("");

  /**
   * OpEx is always an existing outlet and always a regular payment — the Raise
   * form does not even ask, so there is nothing here to choose between.
   *
   * Switching to OpEx CLEARS both rather than merely hiding them. A filter that
   * is invisible but still narrowing the list is the worst version of this
   * feature: the list goes empty and the reason is off screen.
   */
  const capexOnly = expense !== "opex";
  const chooseExpense = (v: string) => {
    setExpense(v);
    if (v === "opex") {
      setStage("");
      setKind("");
    }
  };

  // Built from the rows themselves, so the options can only ever be names the
  // person is already allowed to see — no extra query, and nothing to leak.
  const people = useMemo(
    () => [...new Set(rows.map((r) => r.submitterName))].filter((n) => n !== "—").sort(),
    [rows],
  );
  const branches = useMemo(
    () => [...new Set(rows.flatMap((r) => r.branches))].sort(),
    [rows],
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (
        needle &&
        !r.label.toLowerCase().includes(needle) &&
        !r.requestTitle.toLowerCase().includes(needle) &&
        !r.vendorName.toLowerCase().includes(needle) &&
        !r.submitterName.toLowerCase().includes(needle)
      ) {
        return false;
      }
      if (raisedBy && r.submitterName !== raisedBy) return false;
      if (branch && !r.branches.includes(branch)) return false;
      if (expense && r.expenseType !== expense) return false;
      if (kind && r.paymentKind !== kind) return false;
      // A request can span several outlets, so it matches if ANY of them is of
      // the chosen stage — the same request really can be both.
      if (stage && !r.stages.includes(stage)) return false;
      return true;
    });
  }, [rows, q, raisedBy, branch, expense, stage, kind]);

  const chips: ActiveChip[] = [];
  if (raisedBy) chips.push({ label: `Raised by: ${raisedBy}`, onClear: () => setRaisedBy("") });
  if (branch) chips.push({ label: `Branch: ${branch}`, onClear: () => setBranch("") });
  if (expense) chips.push({ label: EXPENSE_LABEL[expense] ?? expense, onClear: () => setExpense("") });
  if (stage) chips.push({ label: STAGE_LABEL[stage] ?? stage, onClear: () => setStage("") });
  if (kind) chips.push({ label: `${KIND_LABEL[kind] ?? kind} payment`, onClear: () => setKind("") });
  const clearAll = () => {
    setRaisedBy("");
    setBranch("");
    setExpense("");
    setStage("");
    setKind("");
  };

  return (
    <div>
      <SearchBox q={q} setQ={setQ} placeholder="Search request #, title, vendor, raised by…" />

      <FilterPanel chips={chips} onClearAll={clearAll}>
        <FilterSelect
          label="Raised by"
          value={raisedBy}
          onChange={setRaisedBy}
          anyLabel="Anyone"
          options={people.map((p) => ({ value: p, label: p }))}
        />
        <FilterSelect
          label="Branch"
          value={branch}
          onChange={setBranch}
          anyLabel="All branches"
          options={branches.map((b) => ({ value: b, label: b }))}
        />
        <FilterSelect
          label="Expense type"
          value={expense}
          onChange={chooseExpense}
          anyLabel="CapEx and OpEx"
          options={[
            { value: "capex", label: "CapEx — assets & construction" },
            { value: "opex", label: "OpEx — rent & utilities" },
          ]}
        />
        {capexOnly && (
          <>
            <FilterSelect
              label="Payment for"
              value={stage}
              onChange={setStage}
              anyLabel="New and existing"
              options={[
                { value: "upcoming", label: "New Store" },
                { value: "operational", label: "Existing Outlet" },
              ]}
            />
            <FilterSelect
              label="Payment kind"
              value={kind}
              onChange={setKind}
              anyLabel="Regular and milestone"
              options={[
                { value: "regular", label: "Regular — one-off / part" },
                { value: "milestone", label: "Milestone" },
              ]}
            />
          </>
        )}
      </FilterPanel>

      {(q || chips.length > 0) && (
        <p className="mt-2 text-xs text-zinc-500">
          {filtered.length} of {rows.length} shown
        </p>
      )}

      {filtered.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
          {/* Naming the cause matters more than the message. "Nothing here" over
              a filtered list is how someone concludes the app is broken. */}
          {rows.length === 0 ? (
            "Nothing here."
          ) : (
            <>
              <span className="block">Nothing matches the filters you have on.</span>
              <button
                type="button"
                onClick={() => {
                  setQ("");
                  clearAll();
                }}
                className="mt-2 text-xs font-medium text-indigo-600 underline underline-offset-2 dark:text-indigo-400"
              >
                Clear search and filters
              </button>
            </>
          )}
        </div>
      ) : (
        <>
          {/* Mobile */}
          <ul className="mt-4 space-y-3 sm:hidden">
            {filtered.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/requests/${r.threadId}`}
                  className="block rounded-xl border border-zinc-200 bg-white p-4 active:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 font-mono text-[11px] text-zinc-500">
                        {r.label}
                        <DiscussionBadges unreadCount={r.unreadCount} mentioned={r.mentionedUnread} />
                      </p>
                      <p className="mt-0.5 truncate text-base font-medium text-zinc-900 dark:text-zinc-100">
                        {r.requestTitle || r.vendorName}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-zinc-500">
                        {r.requestTitle ? `${r.vendorName} · ` : ""}by {r.submitterName}
                      </p>
                    </div>
                    <StatusPill status={r.status} />
                  </div>
                  <div className="mt-2 flex items-baseline justify-between text-xs">
                    <span className="font-semibold text-zinc-900 tabular-nums dark:text-zinc-100">
                      {formatINR(r.amount)}
                    </span>
                    <span className="text-zinc-500">Requested {r.requestedAt}</span>
                  </div>
                  {r.vendorPending && (
                    <p className="mt-2 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900 dark:text-amber-200">
                      vendor pending — can&rsquo;t approve yet
                    </p>
                  )}
                </Link>
              </li>
            ))}
          </ul>

          {/* Desktop */}
          <section className="mt-4 hidden rounded-2xl border border-zinc-200 bg-white sm:block dark:border-zinc-800 dark:bg-zinc-900">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
                  <tr>
                    <th className="px-5 py-3">Thread · Installment</th>
                    <th className="px-5 py-3">Title / Vendor</th>
                    <th className="px-5 py-3">Raised by</th>
                    <th className="px-5 py-3 text-right">Amount</th>
                    <th className="px-5 py-3">Requested</th>
                    <th className="px-5 py-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={r.id} className="border-b border-zinc-100 last:border-b-0 dark:border-zinc-800">
                      <td className="px-5 py-3 font-mono text-xs">
                        <span className="inline-flex items-center gap-2">
                          <Link
                            href={`/requests/${r.threadId}`}
                            className="font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                          >
                            {r.label}
                          </Link>
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
                        {r.vendorPending && (
                          <span
                            title="Accounts must verify this vendor before the payment can be approved"
                            className="ml-2 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900 dark:text-amber-200"
                          >
                            vendor pending — can&rsquo;t approve yet
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-zinc-500">
                        {r.submitterName}
                        {r.approverName && r.approvedAt && (
                          <span className="block text-[11px] text-emerald-700 dark:text-emerald-400">
                            ✓ {r.approverName}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right font-medium tabular-nums">{formatINR(r.amount)}</td>
                      <td className="px-5 py-3 text-zinc-500">{r.requestedAt}</td>
                      <td className="px-5 py-3"><StatusPill status={r.status} /></td>
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

export function SearchBox({
  q,
  setQ,
  placeholder,
}: {
  q: string;
  setQ: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative mt-4 max-w-md">
      <svg
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <circle cx="11" cy="11" r="8" />
        <path strokeLinecap="round" d="M21 21l-4.35-4.35" />
      </svg>
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        className="w-full rounded-md border border-zinc-200 bg-white py-2 pl-9 pr-8 text-sm placeholder:text-zinc-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-900"
      />
      {q && (
        <button
          type="button"
          onClick={() => setQ("")}
          aria-label="Clear search"
          className="absolute right-2 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          ×
        </button>
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
        : status === "clarification_required"
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
