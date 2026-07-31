"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

export type ComboOption = {
  value: string;
  label: string;
  hint?: string;
  disabled?: boolean;
};

/**
 * Searchable dropdown. Filters options as you type, keyboard-navigable
 * (Arrow keys + Enter + Escape), closes on outside click. Emits the
 * selected option's `value` via onChange. When `name` is set, also
 * renders a hidden input carrying the value so it submits with a form.
 * When `onClear` is set, a × appears next to the caret once a value is
 * chosen.
 */
export default function Combobox({
  options,
  value,
  onChange,
  onClear,
  name,
  required,
  placeholder = "Type to search…",
  emptyLabel = "No matches",
  disabled,
  ariaLabel,
  size = "md",
}: {
  options: ComboOption[];
  value: string;
  onChange: (value: string) => void;
  /**
   * Supply this to get a clear (×) button once something is selected. The
   * parent handles it rather than the combobox emitting "" so that a picker
   * with dependents can decide what else to reset.
   */
  onClear?: () => void;
  name?: string;
  required?: boolean;
  placeholder?: string;
  emptyLabel?: string;
  disabled?: boolean;
  ariaLabel?: string;
  size?: "sm" | "md";
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listboxId = useId();

  const selected = options.find((o) => o.value === value);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => {
      const hay = `${o.label} ${o.hint ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [options, query]);

  // Keep activeIdx in range as filtered list changes
  useEffect(() => {
    if (activeIdx >= filtered.length) setActiveIdx(0);
  }, [filtered.length, activeIdx]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // Scroll active option into view
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [open, activeIdx]);

  function commit(opt: ComboOption | undefined) {
    if (!opt || opt.disabled) return;
    onChange(opt.value);
    setOpen(false);
    setQuery("");
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActiveIdx((i) => Math.min(i + 1, Math.max(filtered.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      if (open) {
        e.preventDefault();
        commit(filtered[activeIdx]);
      }
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        setOpen(false);
        setQuery("");
      }
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  }

  const displayed = open ? query : selected?.label ?? "";
  const inputPad = size === "sm" ? "px-2 py-1.5 text-xs" : "px-3 py-2 text-sm";
  const showClear = !!onClear && !!selected && !disabled;

  return (
    <div ref={rootRef} className="relative">
      <input
        type="text"
        role="combobox"
        aria-controls={listboxId}
        aria-expanded={open}
        aria-autocomplete="list"
        aria-label={ariaLabel}
        autoComplete="off"
        disabled={disabled}
        placeholder={selected ? selected.label : placeholder}
        value={displayed}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActiveIdx(0);
        }}
        onKeyDown={onKey}
        className={`w-full rounded-md border border-zinc-300 bg-white ${
          showClear ? "pr-14" : "pr-8"
        } ${inputPad} dark:border-zinc-700 dark:bg-zinc-900 ${
          disabled ? "cursor-not-allowed opacity-60" : ""
        }`}
      />
      {/* Clear + caret share one right-anchored strip, rather than each
          being positioned at its own offset — two absolutely placed buttons
          drifting apart is a layout bug waiting to happen. */}
      <div className="absolute inset-y-0 right-0 flex items-center">
        {showClear && (
          <button
            type="button"
            onClick={() => {
              onClear?.();
              setQuery("");
              setOpen(false);
            }}
            aria-label="Clear selection"
            title="Clear"
            className="flex h-full w-6 items-center justify-center text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M3 3l6 6M9 3l-6 6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        )}
        <button
          type="button"
          onClick={() => (open ? (setOpen(false), setQuery("")) : setOpen(true))}
          aria-label={open ? "Close list" : "Open list"}
          tabIndex={-1}
          className="flex h-full w-8 items-center justify-center text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {open && (
        <ul
          ref={listRef}
          id={listboxId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-md border border-zinc-200 bg-white py-1 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
        >
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-xs italic text-zinc-500">{emptyLabel}</li>
          ) : (
            filtered.map((opt, i) => {
              const isActive = i === activeIdx;
              const isSelected = opt.value === value;
              return (
                <li
                  key={opt.value}
                  data-idx={i}
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={opt.disabled}
                  onMouseEnter={() => setActiveIdx(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    commit(opt);
                  }}
                  className={`cursor-pointer px-3 py-1.5 ${
                    opt.disabled ? "cursor-not-allowed opacity-50" : ""
                  } ${isActive ? "bg-indigo-50 dark:bg-indigo-950/60" : ""} ${
                    isSelected ? "font-medium text-indigo-700 dark:text-indigo-200" : "text-zinc-800 dark:text-zinc-200"
                  }`}
                >
                  <div>{opt.label}</div>
                  {opt.hint && (
                    <div className="text-[10px] text-zinc-500">{opt.hint}</div>
                  )}
                </li>
              );
            })
          )}
        </ul>
      )}

      {/* Hidden native field so this participates in form submission */}
      {name && (
        <input
          type="hidden"
          name={name}
          value={value}
          required={required}
        />
      )}
    </div>
  );
}
