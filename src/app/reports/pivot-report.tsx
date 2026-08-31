"use client";

import { useMemo, useState } from "react";
import { COA_LABEL } from "@/lib/coa-labels";
import { formatINR } from "@/lib/types";

export type PivotRow = {
  id: string;
  requestId: string;
  amount: number;
  coa: string;
  category: string;
  account: string;
  vendor: string;
  outlet: string;
  stage: string;
  expense: string;
  kind: string;
  raisedBy: string;
  month: string;
};

/** Every field that can be dragged onto rows, columns or filters. */
type FieldKey = Exclude<keyof PivotRow, "id" | "requestId" | "amount">;

const FIELDS: { key: FieldKey; label: string }[] = [
  { key: "coa", label: COA_LABEL.level1 },
  { key: "category", label: COA_LABEL.level2 },
  { key: "account", label: COA_LABEL.level3 },
  { key: "outlet", label: "Outlet" },
  { key: "vendor", label: "Vendor" },
  { key: "expense", label: "Expense type" },
  { key: "stage", label: "New / existing" },
  { key: "kind", label: "Payment kind" },
  { key: "raisedBy", label: "Raised by" },
  { key: "month", label: "Month" },
];
const LABEL = Object.fromEntries(FIELDS.map((f) => [f.key, f.label])) as Record<FieldKey, string>;

type Zone = "rows" | "cols" | "filters";
const ZONE_LABEL: Record<Zone, string> = { rows: "Rows", cols: "Columns", filters: "Filters" };

/**
 * A pivot table, the way a spreadsheet does one.
 *
 * There is no value chooser because there is only ever one value: the amount.
 * Everything else — which fields become rows, which become columns, which just
 * filter — is dragged, or added with +, and recomputed in the browser.
 *
 * All of it happens on data already fetched for the chosen date range. Only
 * the date range goes back to the server, because only the date range changes
 * which rows exist.
 */
export default function PivotReport({ rows }: { rows: PivotRow[] }) {
  const [zones, setZones] = useState<Record<Zone, FieldKey[]>>({
    rows: ["coa"],
    cols: [],
    filters: [],
  });
  // Which values of a filter field are excluded. Absent means everything is in
  // — a filter you have just added should not hide anything yet.
  const [excluded, setExcluded] = useState<Record<string, string[]>>({});
  const [dragging, setDragging] = useState<FieldKey | null>(null);
  const [adding, setAdding] = useState<Zone | null>(null);
  const [openFilter, setOpenFilter] = useState<FieldKey | null>(null);
  // Ticking is a DRAFT until Apply, the way a spreadsheet does it. Applying on
  // every tick makes the table jump under you while you are still choosing,
  // and there is no way to say "these five" without seeing four wrong tables
  // on the way there.
  const [draft, setDraft] = useState<string[]>([]);
  const [search, setSearch] = useState("");

  const placed = new Set([...zones.rows, ...zones.cols, ...zones.filters]);
  const available = FIELDS.filter((f) => !placed.has(f.key));

  function moveTo(field: FieldKey, zone: Zone | null) {
    setZones((z) => {
      const stripped: Record<Zone, FieldKey[]> = {
        rows: z.rows.filter((k) => k !== field),
        cols: z.cols.filter((k) => k !== field),
        filters: z.filters.filter((k) => k !== field),
      };
      if (zone) stripped[zone] = [...stripped[zone], field];
      return stripped;
    });
  }

  /** Distinct values of a field, for the filter checkboxes. */
  const valuesOf = useMemo(() => {
    const out: Partial<Record<FieldKey, string[]>> = {};
    for (const f of zones.filters) {
      out[f] = [...new Set(rows.map((r) => String(r[f])))].sort();
    }
    return out;
  }, [rows, zones.filters]);

  const visible = useMemo(
    () =>
      rows.filter((r) =>
        zones.filters.every((f) => !(excluded[f] ?? []).includes(String(r[f]))),
      ),
    [rows, zones.filters, excluded],
  );

  // ---- The pivot itself ----------------------------------------------------
  const { rowKeys, colKeys, cells, rowTotals, colTotals, grand } = useMemo(() => {
    const cells = new Map<string, number>();
    const rowTotals = new Map<string, number>();
    const colTotals = new Map<string, number>();
    const rowSeen = new Map<string, string[]>();
    let grand = 0;

    for (const r of visible) {
      const rParts = zones.rows.map((f) => String(r[f]));
      const rKey = rParts.join("\u0000") || "All";
      const cKey = zones.cols.map((f) => String(r[f])).join(" · ") || "Total";
      if (!rowSeen.has(rKey)) rowSeen.set(rKey, rParts.length ? rParts : ["All"]);
      cells.set(`${rKey}\u0000|\u0000${cKey}`, (cells.get(`${rKey}\u0000|\u0000${cKey}`) ?? 0) + r.amount);
      rowTotals.set(rKey, (rowTotals.get(rKey) ?? 0) + r.amount);
      colTotals.set(cKey, (colTotals.get(cKey) ?? 0) + r.amount);
      grand += r.amount;
    }

    // Biggest first, in both directions — the point of a report is what is
    // large, not what happens to sort alphabetically.
    const rowKeys = [...rowSeen.entries()]
      .sort((a, b) => (rowTotals.get(b[0]) ?? 0) - (rowTotals.get(a[0]) ?? 0))
      .map(([key, parts]) => ({ key, parts }));
    // With no column field every row has a single bucket, and that bucket IS
    // the row total. Emitting it as well printed the same number twice under
    // two columns both headed "Total".
    const colKeys =
      zones.cols.length === 0
        ? []
        : [...colTotals.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);

    return { rowKeys, colKeys, cells, rowTotals, colTotals, grand };
  }, [visible, zones.rows, zones.cols]);

  const CHIP =
    "inline-flex items-center gap-1 rounded-full bg-indigo-50 py-1 pl-2.5 pr-1.5 text-xs font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-200";

  function DropZone({ zone }: { zone: Zone }) {
    const fields = zones[zone];
    return (
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (dragging) moveTo(dragging, zone);
          setDragging(null);
        }}
        className="min-h-[3.5rem] rounded-xl border-2 border-dashed border-zinc-300 p-2 dark:border-zinc-700"
      >
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
            {ZONE_LABEL[zone]}
          </span>
          <div className="relative">
            <button
              type="button"
              onClick={() => setAdding(adding === zone ? null : zone)}
              disabled={available.length === 0}
              aria-label={`Add a field to ${ZONE_LABEL[zone]}`}
              className="flex h-5 w-5 items-center justify-center rounded-full border border-zinc-300 text-xs text-zinc-600 hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              +
            </button>
            {adding === zone && available.length > 0 && (
              // A menu as well as dragging, because dragging on a phone is
              // close to impossible and this has to work there too.
              <div className="absolute right-0 z-20 mt-1 w-44 rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
                {available.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => {
                      moveTo(f.key, zone);
                      setAdding(null);
                    }}
                    className="block w-full px-3 py-1.5 text-left text-xs text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {fields.length === 0 && (
            <span className="text-[11px] text-zinc-400">Nothing yet — use +</span>
          )}
          {fields.map((f) => (
            <span
              key={f}
              draggable
              onDragStart={() => setDragging(f)}
              onDragEnd={() => setDragging(null)}
              className={`${CHIP} cursor-grab active:cursor-grabbing`}
            >
              {LABEL[f]}
              {zone === "filters" && (
                <button
                  type="button"
                  onClick={() => {
                    if (openFilter === f) {
                      setOpenFilter(null);
                      return;
                    }
                    const vals = [...new Set(rows.map((r) => String(r[f])))].sort();
                    const off = excluded[f] ?? [];
                    setDraft(vals.filter((v) => !off.includes(v)));
                    setSearch("");
                    setOpenFilter(f);
                  }}
                  aria-label={`Choose values for ${LABEL[f]}`}
                  className="rounded-full px-1 text-indigo-500 hover:bg-indigo-100 dark:hover:bg-indigo-900"
                >
                  ▾
                </button>
              )}
              <button
                type="button"
                onClick={() => moveTo(f, null)}
                aria-label={`Remove ${LABEL[f]}`}
                className="flex h-4 w-4 items-center justify-center rounded-full text-indigo-500 hover:bg-indigo-200 dark:hover:bg-indigo-800"
              >
                ×
              </button>
            </span>
          ))}
        </div>

      </div>
    );
  }


  /** The chosen filter's values, at full page width under the three zones.
   *
   * Not inside the Filters box: that box is a third of a row, and hunting for
   * one outlet among nine in a quarter of the width was the whole complaint.
   *
   * Ticking edits a draft and nothing moves until Apply. Deliberately no
   * auto-apply: the point of holding the change is that you can pick five
   * outlets without the table rebuilding four times on the way. */
  function FilterValues() {
    if (!openFilter || !zones.filters.includes(openFilter)) return null;
    const field = openFilter;
    const vals = valuesOf[field] ?? [];
    const q = search.trim().toLowerCase();
    // Search narrows what is LISTED, never what is selected — typing then
    // clearing the box must not quietly drop the ticks you cannot see.
    const shown = q ? vals.filter((v) => v.toLowerCase().includes(q)) : vals;
    const allShownPicked = shown.length > 0 && shown.every((v) => draft.includes(v));
    const isFiltered = (excluded[field] ?? []).length > 0;
    const toggle = (v: string) =>
      setDraft((d) => (d.includes(v) ? d.filter((x) => x !== v) : [...d, v]));

    return (
      <div className="mt-3 w-full max-w-md rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center justify-between gap-2 border-b border-zinc-100 px-4 py-2.5 dark:border-zinc-800">
          <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">{LABEL[field]}</p>
          <button
            type="button"
            onClick={() => setOpenFilter(null)}
            aria-label="Close the value list"
            className="flex h-6 w-6 items-center justify-center rounded text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"
          >
            ✕
          </button>
        </div>

        <div className="p-3">
          <div className="relative">
            <svg
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400"
              viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" />
            </svg>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search"
              aria-label={`Search ${LABEL[field]} values`}
              className="w-full rounded-md border border-zinc-300 bg-white py-2 pl-9 pr-3 text-sm placeholder:text-zinc-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </div>

          <div className="mt-2 max-h-64 overflow-y-auto pr-1">
            <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1.5 text-sm font-medium text-zinc-800 hover:bg-zinc-50 dark:text-zinc-100 dark:hover:bg-zinc-800/60">
              <input
                type="checkbox"
                checked={allShownPicked}
                // Acts on what the search has left on screen, not the whole
                // list — that is what makes "search, select all" useful.
                onChange={() =>
                  setDraft((d) =>
                    allShownPicked
                      ? d.filter((v) => !shown.includes(v))
                      : [...new Set([...d, ...shown])],
                  )
                }
                className="h-4 w-4 shrink-0"
              />
              (Select All)
            </label>

            {shown.length === 0 && (
              <p className="px-1 py-2 text-sm text-zinc-400">No values match &ldquo;{search}&rdquo;.</p>
            )}
            {shown.map((v) => (
              <label
                key={v}
                className="flex cursor-pointer items-center gap-2 rounded px-1 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800/60"
              >
                <input
                  type="checkbox"
                  checked={draft.includes(v)}
                  onChange={() => toggle(v)}
                  className="h-4 w-4 shrink-0"
                />
                <span className="truncate">{v}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-zinc-100 px-3 py-2.5 dark:border-zinc-800">
          <button
            type="button"
            disabled={!isFiltered}
            onClick={() => {
              setExcluded((ex) => ({ ...ex, [field]: [] }));
              setOpenFilter(null);
            }}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            Clear Filter
          </button>
          <button
            type="button"
            onClick={() => {
              setExcluded((ex) => ({ ...ex, [field]: vals.filter((v) => !draft.includes(v)) }));
              setOpenFilter(null);
            }}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
          >
            Apply Filter
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-6">
      {/* The three zones, full width and below the date range — no separate
          field palette. Every field is one + away, and a list of chips that
          only existed to be dragged out of was a box earning no space. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <DropZone zone="rows" />
        <DropZone zone="cols" />
        <DropZone zone="filters" />
      </div>

      <FilterValues />

      {/* The table */}
      <section className="mt-4 overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
              <tr>
                {(zones.rows.length ? zones.rows : (["__all"] as const)).map((f) => (
                  <th key={f} className="whitespace-nowrap px-4 py-3">
                    {f === "__all" ? "" : LABEL[f as FieldKey]}
                  </th>
                ))}
                {colKeys.map((c) => (
                  <th key={c} className="whitespace-nowrap px-4 py-3 text-right">
                    {c}
                  </th>
                ))}
                <th className="whitespace-nowrap px-4 py-3 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {rowKeys.length === 0 ? (
                <tr>
                  <td
                    colSpan={(zones.rows.length || 1) + colKeys.length + 1}
                    className="px-5 py-12 text-center text-sm text-zinc-500"
                  >
                    Nothing to show for this range and these filters.
                  </td>
                </tr>
              ) : (
                rowKeys.map(({ key, parts }) => (
                  <tr key={key} className="border-b border-zinc-100 last:border-b-0 dark:border-zinc-800">
                    {parts.map((p, i) => (
                      <td key={i} className="px-4 py-2 text-zinc-900 dark:text-zinc-100">
                        {p}
                      </td>
                    ))}
                    {colKeys.map((c) => {
                      const v = cells.get(`${key}\u0000|\u0000${c}`);
                      return (
                        <td key={c} className="px-4 py-2 text-right tabular-nums">
                          {/* Blank, not zero. Nothing was spent here, and a
                              grid of 0.00 buries the numbers that matter. */}
                          {v ? formatINR(v) : <span className="text-zinc-300 dark:text-zinc-700">—</span>}
                        </td>
                      );
                    })}
                    <td className="px-4 py-2 text-right font-medium tabular-nums">
                      {formatINR(rowTotals.get(key) ?? 0)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {rowKeys.length > 0 && (
              <tfoot>
                <tr className="border-t border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950">
                  <td
                    colSpan={zones.rows.length || 1}
                    className="px-4 py-3 text-xs font-semibold uppercase text-zinc-500"
                  >
                    Total
                  </td>
                  {colKeys.map((c) => (
                    <td key={c} className="px-4 py-3 text-right font-semibold tabular-nums">
                      {formatINR(colTotals.get(c) ?? 0)}
                    </td>
                  ))}
                  <td className="px-4 py-3 text-right font-semibold tabular-nums">
                    {formatINR(grand)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </section>
    </div>
  );
}
