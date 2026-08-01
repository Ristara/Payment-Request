"use client";

import { useActionState, useMemo, useState } from "react";
import { COA_LABEL } from "@/lib/coa-labels";
import type { ExpenseType } from "@/lib/access-labels";
import {
  createCoaAccount,
  deleteCoaAccount,
  renameCategoryGroup,
  renameCoaGroup,
  toggleCoaAccountActive,
  updateCoaAccount,
} from "@/app/admin/actions";
import { computeRollupIds } from "@/lib/coa";

type Row = {
  id: string;
  code: number;
  subcategory: string;
  category: string;
  coa: string;
  is_active: boolean;
};

/** One printed line: COA · Category · Subcategory (blank = charged at {COA_LABEL.level2.toLowerCase()} level). */
type TableRow = {
  key: string;
  coa: string;
  category: string;
  row: Row | null; // null = a category with no subcategories of its own
  isActive: boolean;
};

/**
 * Chart of Accounts as a flat table — the same shape as the source
 * spreadsheet (COA / Category / Subcategory), so completeness is obvious at
 * a glance.
 *
 * Storage is one row per leaf, each carrying its Category and COA as text.
 * Rows where subcategory === category are the anchors a category-level charge
 * lands on; they are plumbing, shown here as a blank Subcategory cell rather
 * than a duplicate line.
 */
export default function CoaForm({
  rows,
  expenseType,
}: {
  rows: Row[];
  expenseType: ExpenseType;
}) {
  // OpEx has no middle level: its category is the top one, so the column
  // would repeat the value beside it on every row.
  const isOpex = expenseType === "opex";
  const [query, setQuery] = useState("");
  const [showRetired, setShowRetired] = useState(false);
  const [adding, setAdding] = useState(false);

  const rollupIds = useMemo(() => computeRollupIds(rows), [rows]);

  const tableRows: TableRow[] = useMemo(() => {
    // Group by head → category so a category with no subcategories still gets
    // exactly one line.
    const byCat = new Map<string, { coa: string; category: string; subs: Row[] }>();
    for (const r of rows) {
      if (!showRetired && !r.is_active) continue;
      const key = `${r.coa}\u0000${r.category}`;
      let bucket = byCat.get(key);
      if (!bucket) {
        bucket = { coa: r.coa, category: r.category, subs: [] };
        byCat.set(key, bucket);
      }
      if (rollupIds.has(r.id) || r.subcategory === r.category) continue;
      bucket.subs.push(r);
    }

    const out: TableRow[] = [];
    for (const { coa, category, subs } of [...byCat.values()].sort(
      (a, b) => a.coa.localeCompare(b.coa) || a.category.localeCompare(b.category),
    )) {
      if (subs.length === 0) {
        out.push({ key: `${coa}|${category}`, coa, category, row: null, isActive: true });
      } else {
        for (const r of [...subs].sort((x, y) => x.subcategory.localeCompare(y.subcategory))) {
          out.push({ key: r.id, coa, category, row: r, isActive: r.is_active });
        }
      }
    }

    const q = query.trim().toLowerCase();
    if (!q) return out;
    return out.filter(
      (t) =>
        t.coa.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q) ||
        (t.row?.subcategory.toLowerCase().includes(q) ?? false) ||
        String(t.row?.code ?? "").includes(q),
    );
  }, [rows, query, rollupIds, showRetired]);

  const headCount = new Set(tableRows.map((t) => t.coa)).size;
  const catCount = new Set(tableRows.map((t) => `${t.coa}|${t.category}`)).size;
  const subCount = tableRows.filter((t) => t.row).length;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full max-w-md">
          <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <path strokeLinecap="round" d="M21 21l-4.35-4.35" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${COA_LABEL.level1.toLowerCase()}, ${COA_LABEL.level2.toLowerCase()}, ${COA_LABEL.level3.toLowerCase()}, code…`}
            className="w-full rounded-md border border-zinc-200 bg-white py-1.5 pl-9 pr-3 text-sm placeholder:text-zinc-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-xs text-zinc-500">
            {headCount} COA · {catCount} categories · {subCount} subcategories
          </p>
          <label className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
            <input
              type="checkbox"
              checked={showRetired}
              onChange={(e) => setShowRetired(e.target.checked)}
              className="rounded border-zinc-300 dark:border-zinc-600"
            />
            Show retired
          </label>
          <button
            type="button"
            onClick={() => setAdding((a) => !a)}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
          >
            + Add account
          </button>
        </div>
      </div>

      {adding && (
        <AddInlineForm
          heading="New account"
          fixed={{ expense_type: expenseType }}
          fields={[
            { name: "coa", label: COA_LABEL.level1, placeholder: "e.g. Plant & Machinery" },
            ...(isOpex ? [] : [{ name: "category", label: COA_LABEL.level2, placeholder: "e.g. Food Processing Machinery" }]),
            { name: "subcategory", label: COA_LABEL.level3, placeholder: "e.g. Dough Kneader" },
          ]}
          onDone={() => setAdding(false)}
        />
      )}

      {/* Table */}
      <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-left text-[11px] uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950">
              <tr>
                <th className="px-4 py-2.5 font-semibold">{COA_LABEL.level1}</th>
                {!isOpex && <th className="px-4 py-2.5 font-semibold">{COA_LABEL.level2}</th>}
                <th className="px-4 py-2.5 font-semibold">{COA_LABEL.level3}</th>
                <th className="w-16 px-4 py-2.5 text-right font-semibold">Code</th>
                <th className="w-44 px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {tableRows.length === 0 ? (
                <tr>
                  <td colSpan={isOpex ? 4 : 5} className="px-4 py-12 text-center text-sm text-zinc-500">
                    {query ? `No matches for "${query}".` : "No accounts yet."}
                  </td>
                </tr>
              ) : (
                tableRows.map((t, i) => {
                  const prev = tableRows[i - 1];
                  const newCoa = !prev || prev.coa !== t.coa;
                  const newCat = newCoa || prev.category !== t.category;
                  return (
                    <TableLine
                      key={t.key}
                      line={t}
                      showCoa={newCoa}
                      showCategory={newCat}
                      startsGroup={newCoa}
                      expenseType={expenseType}
                    />
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function TableLine({
  line,
  showCoa,
  showCategory,
  startsGroup,
  expenseType,
}: {
  line: TableRow;
  showCoa: boolean;
  showCategory: boolean;
  startsGroup: boolean;
  expenseType: ExpenseType;
}) {
  const isOpex = expenseType === "opex";
  const [editing, setEditing] = useState<null | "coa" | "category" | "subcategory">(null);
  const [editState, editAction] = useActionState(updateCoaAccount, undefined);
  const [coaState, coaAction] = useActionState(renameCoaGroup, undefined);
  const [catState, catAction] = useActionState(renameCategoryGroup, undefined);
  const [delState, delAction, delPending] = useActionState(deleteCoaAccount, undefined);
  const [addingSub, setAddingSub] = useState(false);

  const r = line.row;
  const err = editState?.error || coaState?.error || catState?.error || delState?.error;

  return (
    <>
      <tr
        className={`border-b border-zinc-100 last:border-b-0 dark:border-zinc-800/60 ${
          startsGroup ? "border-t-2 border-t-zinc-200 dark:border-t-zinc-700" : ""
        } ${line.isActive ? "" : "opacity-50"}`}
      >
        {/* COA */}
        <td className="px-4 py-2 align-top">
          {showCoa &&
            (editing === "coa" ? (
              <RenameForm
                action={coaAction}
                hidden={{ old_coa: line.coa }}
                field="new_coa"
                value={line.coa}
                onDone={() => setEditing(null)}
              />
            ) : (
              <button
                type="button"
                onClick={() => setEditing("coa")}
                title={`Rename this ${COA_LABEL.level1.toLowerCase()} everywhere`}
                className="text-left font-medium text-zinc-900 hover:text-indigo-600 dark:text-zinc-100 dark:hover:text-indigo-400"
              >
                {line.coa}
              </button>
            ))}
        </td>

        {/* Category — absent on OpEx, whose category IS the top level. */}
        {!isOpex && (
          <>
          <td className="px-4 py-2 align-top">
            {showCategory &&
              (editing === "category" ? (
                <RenameForm
                  action={catAction}
                  hidden={{ coa: line.coa, old_category: line.category }}
                  field="new_category"
                  value={line.category}
                  onDone={() => setEditing(null)}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setEditing("category")}
                  title={`Rename this ${COA_LABEL.level2.toLowerCase()} everywhere`}
                  className="text-left text-zinc-800 hover:text-indigo-600 dark:text-zinc-200 dark:hover:text-indigo-400"
                >
                  {line.category}
                </button>
              ))}
          </td>
  
          </>
        )}
        {/* Subcategory */}
        <td className="px-4 py-2 align-top">
          {!r ? (
            <span className="text-xs italic text-zinc-400">charged at {COA_LABEL.level2.toLowerCase()} level</span>
          ) : editing === "subcategory" ? (
            <form
              action={(fd) => {
                editAction(fd);
                setEditing(null);
              }}
              className="flex items-center gap-2"
            >
              <input type="hidden" name="id" value={r.id} />
              <input type="hidden" name="category" value={r.category} />
              <input type="hidden" name="coa" value={r.coa} />
              <input
                name="subcategory"
                defaultValue={r.subcategory}
                required
                autoFocus
                className="flex-1 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              />
              <button type="submit" className="rounded-md bg-indigo-600 px-2 py-1 text-xs text-white">
                Save
              </button>
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
              >
                Cancel
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setEditing("subcategory")}
              className={`text-left hover:text-indigo-600 dark:hover:text-indigo-400 ${
                line.isActive ? "text-zinc-800 dark:text-zinc-200" : "text-zinc-400 line-through"
              }`}
            >
              {r.subcategory}
            </button>
          )}
        </td>

        <td className="px-4 py-2 text-right align-top font-mono text-[11px] text-zinc-400 tabular-nums">
          {r?.code ?? ""}
        </td>

        {/* Actions */}
        <td className="px-4 py-2 text-right align-top">
          <span className="inline-flex items-center gap-2">
            {showCategory && (
              <button
                type="button"
                onClick={() => setAddingSub((a) => !a)}
                className="text-[11px] font-medium text-indigo-600 hover:underline dark:text-indigo-400"
              >
                + Sub
              </button>
            )}
            {r && (
              <>
                <form action={toggleCoaAccountActive}>
                  <input type="hidden" name="id" value={r.id} />
                  <input type="hidden" name="is_active" value={r.is_active ? "false" : "true"} />
                  <button type="submit" className="text-[11px] font-medium text-zinc-500 hover:underline">
                    {r.is_active ? "Retire" : "Restore"}
                  </button>
                </form>
                <form
                  action={delAction}
                  onSubmit={(e) => {
                    if (!confirm(`Delete "${r.subcategory}" (code ${r.code})? This can't be undone.`)) {
                      e.preventDefault();
                    }
                  }}
                >
                  <input type="hidden" name="id" value={r.id} />
                  <button
                    type="submit"
                    disabled={delPending}
                    className="text-[11px] font-medium text-red-600 hover:underline disabled:opacity-60 dark:text-red-400"
                  >
                    Delete
                  </button>
                </form>
              </>
            )}
          </span>
        </td>
      </tr>

      {err && (
        <tr>
          <td colSpan={isOpex ? 4 : 5} className="bg-red-50 px-4 py-1.5 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
            {err}
          </td>
        </tr>
      )}

      {addingSub && (
        <tr>
          <td colSpan={isOpex ? 4 : 5} className="bg-zinc-50 px-4 py-2 dark:bg-zinc-950">
            <AddInlineForm
              heading={`New ${COA_LABEL.level3.toLowerCase()} under ${line.category}`}
              fixed={{ coa: line.coa, category: line.category, expense_type: expenseType }}
              fields={[{ name: "subcategory", label: COA_LABEL.level3, placeholder: "e.g. Dough Kneader" }]}
              onDone={() => setAddingSub(false)}
            />
          </td>
        </tr>
      )}
    </>
  );
}

function RenameForm({
  action,
  hidden,
  field,
  value,
  onDone,
}: {
  action: (fd: FormData) => void;
  hidden: Record<string, string>;
  field: string;
  value: string;
  onDone: () => void;
}) {
  return (
    <form
      action={(fd) => {
        action(fd);
        onDone();
      }}
      className="flex items-center gap-2"
    >
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <input
        name={field}
        defaultValue={value}
        required
        autoFocus
        className="flex-1 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-950"
      />
      <button type="submit" className="rounded-md bg-indigo-600 px-2 py-1 text-xs text-white">
        Save
      </button>
      <button
        type="button"
        onClick={onDone}
        className="rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
      >
        Cancel
      </button>
    </form>
  );
}

function AddInlineForm({
  heading,
  fixed = {},
  fields,
  onDone,
}: {
  heading: string;
  fixed?: Record<string, string>;
  fields: { name: string; label: string; placeholder?: string }[];
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState(createCoaAccount, undefined);

  return (
    <form
      action={action}
      className="rounded-lg border border-indigo-200 bg-indigo-50/60 p-3 dark:border-indigo-900 dark:bg-indigo-950/30"
    >
      <p className="text-xs font-semibold text-indigo-900 dark:text-indigo-200">{heading}</p>
      {Object.entries(fixed).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end">
        {fields.map((f) => (
          <div key={f.name} className="flex-1">
            <label className="block text-[11px] font-medium text-zinc-700 dark:text-zinc-300">{f.label}</label>
            <input
              name={f.name}
              required
              placeholder={f.placeholder}
              className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
          </div>
        ))}
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
          >
            {pending ? "Adding…" : "Add"}
          </button>
          <button
            type="button"
            onClick={onDone}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
          >
            Close
          </button>
        </div>
      </div>
      {state?.error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{state.error}</p>}
      {state?.info && <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-400">{state.info}</p>}
    </form>
  );
}
