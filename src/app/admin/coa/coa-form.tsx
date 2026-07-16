"use client";

import { useActionState, useMemo, useState } from "react";
import {
  createCoaAccount,
  deleteCoaAccount,
  toggleCoaAccountActive,
  updateCoaAccount,
} from "@/app/admin/actions";

type Row = {
  id: string;
  code: number;
  subcategory: string;
  category: string;
  coa: string;
  is_active: boolean;
};

export default function CoaForm({ rows }: { rows: Row[] }) {
  const [createState, createAction, createPending] = useActionState(createCoaAccount, undefined);
  const [editState, editAction, editPending] = useActionState(updateCoaAccount, undefined);
  const [deleteState, deleteAction, deletePending] = useActionState(deleteCoaAccount, undefined);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.subcategory.toLowerCase().includes(q) ||
        r.category.toLowerCase().includes(q) ||
        r.coa.toLowerCase().includes(q) ||
        String(r.code).includes(q),
    );
  }, [rows, query]);

  return (
    <div className="space-y-6">
      {/* Add form */}
      <form
        action={createAction}
        className="grid grid-cols-1 gap-3 rounded-2xl border border-zinc-200 bg-white p-6 sm:grid-cols-4 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <Field name="subcategory" label="Subcategory" placeholder="e.g. Electric Vehicles" />
        <Field name="category" label="Category" placeholder="e.g. Motor Vehicles" />
        <Field name="coa" label="COA" placeholder="e.g. Motor Vehicles" />
        <div className="flex items-end">
          <button
            type="submit"
            disabled={createPending}
            className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {createPending ? "Adding…" : "Add account"}
          </button>
        </div>
        {createState?.error && (
          <p className="text-xs text-red-600 sm:col-span-4 dark:text-red-400">{createState.error}</p>
        )}
        {createState?.info && (
          <p className="text-xs text-emerald-600 sm:col-span-4 dark:text-emerald-400">{createState.info}</p>
        )}
      </form>

      {editState?.error && (
        <p className="text-xs text-red-600 dark:text-red-400">Edit: {editState.error}</p>
      )}
      {deleteState?.error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {deleteState.error}
        </div>
      )}

      {/* Table */}
      <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center justify-between gap-3 border-b border-zinc-100 px-5 py-3 dark:border-zinc-800">
          <p className="text-xs text-zinc-500">
            {filtered.length === rows.length
              ? `${rows.length} account${rows.length === 1 ? "" : "s"}`
              : `${filtered.length} of ${rows.length}`}
          </p>
          <div className="relative w-full max-w-xs">
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
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search code, subcategory, category, COA…"
              className="w-full rounded-md border border-zinc-200 bg-white py-1.5 pl-9 pr-8 text-sm placeholder:text-zinc-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-900"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                ×
              </button>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
              <tr>
                <th className="px-5 py-3">Code</th>
                <th className="px-5 py-3">Subcategory</th>
                <th className="px-5 py-3">Category</th>
                <th className="px-5 py-3">COA</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-sm text-zinc-500">
                    {rows.length === 0 ? "No accounts yet." : `No matches for "${query}".`}
                  </td>
                </tr>
              ) : (
                filtered.map((r) => {
                  const isEditing = editingId === r.id;
                  return (
                    <tr key={r.id} className="border-b border-zinc-100 last:border-b-0 dark:border-zinc-800">
                      {isEditing ? (
                        <EditRow
                          row={r}
                          pending={editPending}
                          action={editAction}
                          onCancel={() => setEditingId(null)}
                          onSuccess={() => setEditingId(null)}
                        />
                      ) : (
                        <>
                          <td className="px-5 py-3 font-mono text-xs text-zinc-500">{r.code}</td>
                          <td className="px-5 py-3 text-zinc-900 dark:text-zinc-100">{r.subcategory}</td>
                          <td className="px-5 py-3 text-zinc-600 dark:text-zinc-400">{r.category}</td>
                          <td className="px-5 py-3 text-zinc-600 dark:text-zinc-400">{r.coa}</td>
                          <td className="px-5 py-3">
                            <span
                              className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                                r.is_active
                                  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200"
                                  : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                              }`}
                            >
                              {r.is_active ? "Active" : "Inactive"}
                            </span>
                          </td>
                          <td className="px-5 py-3">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => setEditingId(r.id)}
                                className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                              >
                                Edit
                              </button>
                              <form action={toggleCoaAccountActive}>
                                <input type="hidden" name="id" value={r.id} />
                                <input type="hidden" name="is_active" value={r.is_active ? "false" : "true"} />
                                <button
                                  type="submit"
                                  className="text-xs font-medium text-zinc-600 hover:underline dark:text-zinc-400"
                                >
                                  {r.is_active ? "Deactivate" : "Reactivate"}
                                </button>
                              </form>
                              <form
                                action={deleteAction}
                                onSubmit={(e) => {
                                  if (!confirm(`Delete account "${r.subcategory}" (code ${r.code})? This can't be undone.`)) {
                                    e.preventDefault();
                                  }
                                }}
                              >
                                <input type="hidden" name="id" value={r.id} />
                                <button
                                  type="submit"
                                  disabled={deletePending}
                                  className="text-xs font-medium text-red-600 hover:underline disabled:opacity-60 dark:text-red-400"
                                >
                                  Delete
                                </button>
                              </form>
                            </div>
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Field({ name, label, placeholder }: { name: string; label: string; placeholder: string }) {
  return (
    <div>
      <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">{label}</label>
      <input
        name={name}
        required
        placeholder={placeholder}
        className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
      />
    </div>
  );
}

function EditRow({
  row,
  pending,
  action,
  onCancel,
}: {
  row: Row;
  pending: boolean;
  action: (formData: FormData) => void;
  onCancel: () => void;
  onSuccess: () => void;
}) {
  return (
    <>
      <td className="px-5 py-3 font-mono text-xs text-zinc-500">{row.code}</td>
      <td className="px-5 py-3" colSpan={4}>
        <form
          action={(fd) => {
            action(fd);
            onCancel();
          }}
          className="grid grid-cols-1 gap-2 sm:grid-cols-3"
        >
          <input type="hidden" name="id" value={row.id} />
          <input
            name="subcategory"
            defaultValue={row.subcategory}
            required
            className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          <input
            name="category"
            defaultValue={row.category}
            required
            className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          <input
            name="coa"
            defaultValue={row.coa}
            required
            className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          <div className="flex gap-2 sm:col-span-3">
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              Save
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
            >
              Cancel
            </button>
          </div>
        </form>
      </td>
      <td />
    </>
  );
}
