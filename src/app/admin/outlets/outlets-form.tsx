"use client";

import { useActionState, useState } from "react";
import { createOutlet, deleteOutlet, setOutletStage, toggleOutletActive, updateOutletName } from "@/app/admin/actions";

type Outlet = {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
  stage: "upcoming" | "operational";
};

export default function OutletsForm({ outlets }: { outlets: Outlet[] }) {
  const [createState, createAction, createPending] = useActionState(createOutlet, undefined);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editState, editAction, editPending] = useActionState(updateOutletName, undefined);
  const [deleteState, deleteAction, deletePending] = useActionState(deleteOutlet, undefined);

  return (
    <div className="space-y-6">
      {/* Create form */}
      <form
        action={createAction}
        className="grid grid-cols-1 gap-3 rounded-2xl border border-zinc-200 bg-white p-6 sm:grid-cols-4 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <div>
          <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">Code</label>
          <input
            name="code"
            required
            placeholder="HSR"
            className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">Name</label>
          <input
            name="name"
            required
            placeholder="Babai Tiffins HSR"
            className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">Stage</label>
          <select
            name="stage"
            defaultValue="operational"
            className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="operational">Operational (existing)</option>
            <option value="upcoming">Upcoming (new store)</option>
          </select>
        </div>
        <div className="flex items-end">
          <button
            type="submit"
            disabled={createPending}
            className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {createPending ? "Adding…" : "Add outlet"}
          </button>
        </div>
        {createState?.error && (
          <p className="text-xs text-red-600 sm:col-span-4 dark:text-red-400">{createState.error}</p>
        )}
        {createState?.info && (
          <p className="text-xs text-emerald-600 sm:col-span-4 dark:text-emerald-400">{createState.info}</p>
        )}
      </form>

      {/* Action status */}
      {editState?.error && (
        <p className="text-xs text-red-600 dark:text-red-400">Edit: {editState.error}</p>
      )}
      {deleteState?.error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {deleteState.error}
        </div>
      )}

      {/* Outlets list */}
      <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
              <tr>
                <th className="px-5 py-3">Code</th>
                <th className="px-5 py-3">Name</th>
                <th className="px-5 py-3">Stage</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {outlets.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-sm text-zinc-500">
                    No outlets yet. Add your first above.
                  </td>
                </tr>
              ) : (
                outlets.map((o) => {
                  const isEditing = editingId === o.id;
                  return (
                    <tr key={o.id} className="border-b border-zinc-100 last:border-b-0 dark:border-zinc-800">
                      <td className="px-5 py-3 font-mono text-xs text-zinc-500">{o.code}</td>
                      <td className="px-5 py-3">
                        {isEditing ? (
                          <form
                            action={(fd) => {
                              editAction(fd);
                              setEditingId(null);
                            }}
                            className="flex items-center gap-2"
                          >
                            <input type="hidden" name="id" value={o.id} />
                            <input
                              name="name"
                              defaultValue={o.name}
                              autoFocus
                              required
                              className="flex-1 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                            />
                            <button
                              type="submit"
                              disabled={editPending}
                              className="rounded-md bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingId(null)}
                              className="rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
                            >
                              Cancel
                            </button>
                          </form>
                        ) : (
                          <span className="text-zinc-900 dark:text-zinc-100">{o.name}</span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <form action={setOutletStage} className="inline">
                          <input type="hidden" name="id" value={o.id} />
                          <input
                            type="hidden"
                            name="stage"
                            value={o.stage === "upcoming" ? "operational" : "upcoming"}
                          />
                          <button
                            type="submit"
                            title="Click to switch stage"
                            className={`rounded-full px-2 py-0.5 text-[11px] font-medium hover:ring-1 hover:ring-indigo-300 ${
                              o.stage === "upcoming"
                                ? "bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-200"
                                : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                            }`}
                          >
                            {o.stage === "upcoming" ? "Upcoming" : "Operational"} ⇄
                          </button>
                        </form>
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                            o.is_active
                              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200"
                              : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                          }`}
                        >
                          {o.is_active ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center justify-end gap-2">
                          {!isEditing && (
                            <button
                              type="button"
                              onClick={() => setEditingId(o.id)}
                              className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                            >
                              Edit
                            </button>
                          )}
                          <form action={toggleOutletActive}>
                            <input type="hidden" name="id" value={o.id} />
                            <input type="hidden" name="is_active" value={o.is_active ? "false" : "true"} />
                            <button
                              type="submit"
                              className="text-xs font-medium text-zinc-600 hover:underline dark:text-zinc-400"
                            >
                              {o.is_active ? "Deactivate" : "Reactivate"}
                            </button>
                          </form>
                          <form
                            action={deleteAction}
                            onSubmit={(e) => {
                              if (!confirm(`Delete outlet "${o.name}"? This can't be undone.`)) {
                                e.preventDefault();
                              }
                            }}
                          >
                            <input type="hidden" name="id" value={o.id} />
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
