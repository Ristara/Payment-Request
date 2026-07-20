"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { VENDOR_STATUS_LABEL } from "@/lib/routing";

export type VendorListItem = {
  id: string;
  name: string;
  gstin: string | null;
  pan: string;
  status: "pending" | "approved" | "rejected";
  submitter_name: string | null;
};

/**
 * Client-side vendor list with live type-to-filter search — the list is
 * small (tens to low hundreds), so filtering in the browser is instant
 * and needs no Search button or server round-trip.
 */
export default function VendorsList({ vendors }: { vendors: VendorListItem[] }) {
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return vendors;
    return vendors.filter(
      (v) =>
        v.name.toLowerCase().includes(needle) ||
        (v.gstin ?? "").toLowerCase().includes(needle) ||
        v.pan.toLowerCase().includes(needle),
    );
  }, [vendors, q]);

  return (
    <div>
      {/* Live search — filters as you type */}
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
          placeholder="Type to search name, GSTIN, PAN…"
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
      {q && (
        <p className="mt-2 text-xs text-zinc-500">
          {filtered.length} match{filtered.length === 1 ? "" : "es"} for &ldquo;{q}&rdquo;
        </p>
      )}

      {filtered.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
          {q ? `No vendors match "${q}".` : "No vendors here yet."}
        </div>
      ) : (
        <>
          {/* Mobile: card list */}
          <ul className="mt-4 space-y-3 sm:hidden">
            {filtered.map((v) => (
              <li key={v.id}>
                <Link
                  href={`/vendors/${v.id}`}
                  className="block rounded-xl border border-zinc-200 bg-white p-4 active:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-base font-medium text-zinc-900 dark:text-zinc-100">{v.name}</p>
                      <p className="mt-0.5 truncate font-mono text-xs text-zinc-500">
                        {v.gstin ? `GSTIN ${v.gstin}` : "PAN " + v.pan + " · Not GST registered"}
                      </p>
                    </div>
                    <VendorStatusPill status={v.status} />
                  </div>
                  <p className="mt-2 text-xs text-zinc-500">
                    Submitted by {v.submitter_name ?? "—"}
                  </p>
                </Link>
              </li>
            ))}
          </ul>

          {/* Desktop: table */}
          <section className="mt-4 hidden rounded-2xl border border-zinc-200 bg-white sm:block dark:border-zinc-800 dark:bg-zinc-900">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
                  <tr>
                    <th className="px-5 py-3">Name</th>
                    <th className="px-5 py-3">GSTIN</th>
                    <th className="px-5 py-3">PAN</th>
                    <th className="px-5 py-3">Submitted by</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((v) => (
                    <tr key={v.id} className="border-b border-zinc-100 last:border-b-0 dark:border-zinc-800">
                      <td className="px-5 py-3 font-medium text-zinc-900 dark:text-zinc-100">{v.name}</td>
                      <td className="px-5 py-3 font-mono text-xs text-zinc-600 dark:text-zinc-400">
                        {v.gstin ?? <span className="italic text-zinc-400">unregistered</span>}
                      </td>
                      <td className="px-5 py-3 font-mono text-xs text-zinc-600 dark:text-zinc-400">{v.pan}</td>
                      <td className="px-5 py-3 text-zinc-600 dark:text-zinc-400">{v.submitter_name ?? "—"}</td>
                      <td className="px-5 py-3"><VendorStatusPill status={v.status} /></td>
                      <td className="px-5 py-3 text-right">
                        <Link href={`/vendors/${v.id}`} className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400">View →</Link>
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

function VendorStatusPill({ status }: { status: string }) {
  const color =
    status === "approved"
      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200"
      : status === "rejected"
        ? "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-200"
        : "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-200";
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${color}`}>
      {VENDOR_STATUS_LABEL[status] ?? status}
    </span>
  );
}
