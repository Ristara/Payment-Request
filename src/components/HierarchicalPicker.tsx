"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { computeRollupIds } from "@/lib/coa";

export type CoaOption = {
  id: string;
  subcategory: string;
  category: string;
  coa: string;
};

/**
 * Full-screen hierarchical picker à la Zoho Expense.
 * Renders a readonly-looking trigger that shows the current selection.
 * Tap → opens a sheet (bottom-sheet feel on mobile, centered dialog on
 * desktop) with a search box and a grouped list:
 *
 *   COA head (section)
 *     ↳ Category
 *         ↳ Subcategory   ← tappable leaf
 *
 * Search filters on all three levels; sections with no visible leaves
 * are hidden.
 */
export default function HierarchicalPicker({
  accounts,
  value,
  onChange,
  name,
  required,
  placeholder = "Pick a subcategory",
  ariaLabel = "Subcategory",
  title = "Category",
  size = "md",
}: {
  accounts: CoaOption[];
  value: string;
  onChange: (id: string) => void;
  name?: string;
  required?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  title?: string;
  size?: "sm" | "md";
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const selected = accounts.find((a) => a.id === value) ?? null;

  const inputPad = size === "sm" ? "px-2 py-1.5 text-xs" : "px-3 py-2 text-sm";

  // Lock body scroll while the sheet is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`flex w-full items-center justify-between gap-2 rounded-md border border-zinc-300 bg-white text-left text-zinc-800 ${inputPad} disabled:cursor-not-allowed disabled:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100`}
      >
        <span className={`truncate ${selected ? "" : "text-zinc-400"}`}>
          {selected ? selected.subcategory : placeholder}
        </span>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="flex-none text-zinc-400">
          <path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {name && (
        <input type="hidden" name={name} value={value} required={required} />
      )}

      {mounted && open &&
        createPortal(
          <PickerSheet
            title={title}
            accounts={accounts}
            value={value}
            query={query}
            onQueryChange={setQuery}
            onClose={() => setOpen(false)}
            onPick={(id) => {
              onChange(id);
              setOpen(false);
              setQuery("");
            }}
          />,
          document.body,
        )}
    </>
  );
}

function PickerSheet({
  title,
  accounts,
  value,
  query,
  onQueryChange,
  onClose,
  onPick,
}: {
  title: string;
  accounts: CoaOption[];
  value: string;
  query: string;
  onQueryChange: (q: string) => void;
  onClose: () => void;
  onPick: (id: string) => void;
}) {
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // Auto-focus search on open, but don't blow up the viewport on iOS —
    // no scrollIntoView, and delay one frame to let layout settle.
    const id = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, []);

  // Build the tree once: COA → Category → [Subcategory rows].
  // Rollup subs (subcategory that is also a category label elsewhere) are
  // NOT selectable leaves — filter them out so the picker only offers
  // real spendable rows.
  const tree = useMemo(() => {
    const rollups = computeRollupIds(accounts);
    return buildTree(accounts.filter((a) => !rollups.has(a.id)));
  }, [accounts]);

  // Filter tree by query on any level.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tree;
    return tree
      .map((coa) => {
        const cats = coa.categories
          .map((cat) => {
            const subs = cat.subs.filter(
              (s) =>
                s.subcategory.toLowerCase().includes(q) ||
                cat.category.toLowerCase().includes(q) ||
                coa.coa.toLowerCase().includes(q),
            );
            return { ...cat, subs };
          })
          .filter((c) => c.subs.length > 0);
        return { ...coa, categories: cats };
      })
      .filter((coa) => coa.categories.length > 0);
  }, [tree, query]);

  const totalHits = filtered.reduce(
    (s, coa) => s + coa.categories.reduce((ss, cat) => ss + cat.subs.length, 0),
    0,
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:h-[80vh] sm:max-w-lg sm:rounded-2xl dark:bg-zinc-900">
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-zinc-100 px-3 py-3 dark:border-zinc-800">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path d="M2 2l10 10M12 2L2 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
          <h2 className="flex-1 text-center text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {title}
          </h2>
          {/* Placeholder to balance the header — no "add" action for now. */}
          <span className="h-8 w-8" aria-hidden="true" />
        </div>

        {/* Search */}
        <div className="border-b border-zinc-100 px-3 py-2 dark:border-zinc-800">
          <div className="relative">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="11" cy="11" r="8" />
              <path strokeLinecap="round" d="M21 21l-4.35-4.35" />
            </svg>
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder="Search"
              className="w-full rounded-lg bg-zinc-100 py-2 pl-9 pr-3 text-sm placeholder:text-zinc-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:bg-zinc-900"
            />
          </div>
        </div>

        {/* Tap-hint — clarifies that only the leaves are pickable. */}
        <p className="border-b border-zinc-100 bg-indigo-50/50 px-4 py-2 text-[11px] text-indigo-700 dark:border-zinc-800 dark:bg-indigo-950/30 dark:text-indigo-200">
          Tap a <strong>subcategory</strong> to pick. COA head and Category are shown for context only.
        </p>

        {/* List */}
        <div className="flex-1 overflow-y-auto overscroll-contain">
          {filtered.length === 0 ? (
            <p className="p-8 text-center text-sm text-zinc-500">No matches for &ldquo;{query}&rdquo;.</p>
          ) : (
            <>
              <ul>
                {filtered.map((coa) => (
                  <li key={coa.coa}>
                    {/* COA head — non-selectable section header */}
                    <p
                      aria-hidden="true"
                      className="cursor-default select-none border-t border-zinc-200 bg-zinc-50 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400"
                    >
                      {coa.coa}
                    </p>
                    {coa.categories.map((cat) => (
                      <div key={cat.category}>
                        {/* Category — non-selectable subheader */}
                        <p
                          aria-hidden="true"
                          className="flex cursor-default select-none items-center gap-2 px-4 py-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400"
                        >
                          <Arrow muted />
                          <span className="min-w-0 truncate">{cat.category}</span>
                        </p>
                        <ul>
                          {cat.subs.map((s) => {
                            const isSelected = s.id === value;
                            return (
                              <li key={s.id}>
                                <button
                                  type="button"
                                  onClick={() => onPick(s.id)}
                                  role="option"
                                  aria-selected={isSelected}
                                  className={`flex w-full items-center gap-3 border-b border-zinc-100 px-4 py-3 pl-10 text-left text-sm transition-colors last:border-b-0 hover:bg-indigo-50 active:bg-indigo-100 dark:border-zinc-800/60 dark:hover:bg-indigo-950/40 ${
                                    isSelected
                                      ? "bg-indigo-50 font-medium text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-200"
                                      : "text-zinc-900 dark:text-zinc-100"
                                  }`}
                                >
                                  <span className="min-w-0 flex-1 truncate">{s.subcategory}</span>
                                  {isSelected ? <CheckIcon /> : <ChevronRight />}
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ))}
                  </li>
                ))}
              </ul>
              {query.trim() && (
                <p className="p-3 text-center text-[11px] text-zinc-500">
                  {totalHits} match{totalHits === 1 ? "" : "es"}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Arrow({ muted = false }: { muted?: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      aria-hidden="true"
      className={`flex-none ${muted ? "text-zinc-300 dark:text-zinc-600" : "text-zinc-400"}`}
    >
      <path d="M2 2v4a2 2 0 002 2h6M7 5l3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronRight() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" className="flex-none text-zinc-300 dark:text-zinc-600">
      <path d="M5 3l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" className="flex-none text-indigo-600 dark:text-indigo-300">
      <path d="M3 7.5l3 3 5-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function buildTree(accounts: CoaOption[]) {
  const byCoa = new Map<string, Map<string, CoaOption[]>>();
  for (const a of accounts) {
    let cats = byCoa.get(a.coa);
    if (!cats) {
      cats = new Map();
      byCoa.set(a.coa, cats);
    }
    const subs = cats.get(a.category) ?? [];
    subs.push(a);
    cats.set(a.category, subs);
  }
  const coaKeys = [...byCoa.keys()].sort((a, b) => a.localeCompare(b));
  return coaKeys.map((coa) => ({
    coa,
    categories: [...(byCoa.get(coa) ?? new Map()).entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([category, subs]) => ({
        category,
        subs: [...subs].sort((x, y) => x.subcategory.localeCompare(y.subcategory)),
      })),
  }));
}
