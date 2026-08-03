"use client";

import { useState, type ReactNode } from "react";

/**
 * The filter shell every list shares.
 *
 * Collapsed by default and showing a count, because the owner works from a
 * phone: a permanently expanded row of controls would push the actual list
 * below the fold, which is the opposite of helping someone find something.
 *
 * The chips are the important part. A filtered list that looks empty is
 * indistinguishable from a list that IS empty, and the second conclusion is
 * the one people jump to — so anything currently narrowing the list is named
 * on screen, and removable in one tap, whether or not the panel is open.
 */

export type ActiveChip = { label: string; onClear: () => void };

export function FilterPanel({
  chips,
  onClearAll,
  children,
}: {
  chips: ActiveChip[];
  onClearAll: () => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const count = chips.length;

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className={
            count > 0
              ? "inline-flex items-center gap-1.5 rounded-full border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 dark:border-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
              : "inline-flex items-center gap-1.5 rounded-full border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
          }
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M3 5h18M6 12h12M10 19h4" />
          </svg>
          Filters
          {count > 0 && (
            <span className="rounded-full bg-indigo-600 px-1.5 text-[10px] font-bold text-white">{count}</span>
          )}
        </button>

        {/* Chips sit outside the panel deliberately: closing the panel must not
            hide the reason the list is short. */}
        {chips.map((c) => (
          <span
            key={c.label}
            className="inline-flex items-center gap-1 rounded-full bg-zinc-100 py-1 pl-2.5 pr-1 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
          >
            {c.label}
            <button
              type="button"
              onClick={c.onClear}
              aria-label={`Remove filter ${c.label}`}
              className="flex h-4 w-4 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-300 hover:text-zinc-900 dark:hover:bg-zinc-600 dark:hover:text-white"
            >
              ×
            </button>
          </span>
        ))}

        {count > 1 && (
          <button
            type="button"
            onClick={onClearAll}
            className="text-xs font-medium text-zinc-500 underline underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            Clear all
          </button>
        )}
      </div>

      {open && (
        <div className="mt-3 grid grid-cols-1 gap-3 rounded-xl border border-zinc-200 bg-white p-3 sm:grid-cols-2 lg:grid-cols-4 dark:border-zinc-800 dark:bg-zinc-900">
          {children}
        </div>
      )}
    </div>
  );
}

export function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-zinc-500">
        {label}
      </span>
      {children}
    </label>
  );
}

const CONTROL =
  "w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-950";

export function FilterSelect({
  label,
  value,
  onChange,
  options,
  anyLabel,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  anyLabel: string;
}) {
  return (
    <FilterField label={label}>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={CONTROL}>
        <option value="">{anyLabel}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </FilterField>
  );
}

/**
 * A min/max pair. inputMode="decimal" rather than type="number": on a phone
 * type="number" still opens a keypad but silently discards a value the browser
 * considers malformed, so a half-typed amount can vanish as you type it.
 */
export function FilterRange({
  label,
  min,
  max,
  onMin,
  onMax,
}: {
  label: string;
  min: string;
  max: string;
  onMin: (v: string) => void;
  onMax: (v: string) => void;
}) {
  return (
    <FilterField label={label}>
      <div className="flex items-center gap-1.5">
        <input
          value={min}
          onChange={(e) => onMin(e.target.value.replace(/[^\d.]/g, ""))}
          inputMode="decimal"
          placeholder="Min"
          aria-label={`${label} minimum`}
          className={CONTROL}
        />
        <span className="text-xs text-zinc-400">to</span>
        <input
          value={max}
          onChange={(e) => onMax(e.target.value.replace(/[^\d.]/g, ""))}
          inputMode="decimal"
          placeholder="Max"
          aria-label={`${label} maximum`}
          className={CONTROL}
        />
      </div>
    </FilterField>
  );
}

export function FilterDateRange({
  label,
  from,
  to,
  onFrom,
  onTo,
}: {
  label: string;
  from: string;
  to: string;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
}) {
  return (
    <FilterField label={label}>
      <div className="flex items-center gap-1.5">
        <input
          type="date"
          value={from}
          onChange={(e) => onFrom(e.target.value)}
          aria-label={`${label} from`}
          className={CONTROL}
        />
        <span className="text-xs text-zinc-400">to</span>
        <input
          type="date"
          value={to}
          onChange={(e) => onTo(e.target.value)}
          aria-label={`${label} to`}
          className={CONTROL}
        />
      </div>
    </FilterField>
  );
}
