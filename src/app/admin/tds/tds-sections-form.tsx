"use client";

import { useActionState, useState } from "react";
import {
  createTdsSection,
  deleteTdsSection,
  setTdsSectionActive,
  updateTdsSection,
} from "@/app/admin/actions";

export type TdsSection = {
  id: string;
  code: string;
  name: string;
  rate: number | null;
  is_active: boolean;
};

const FIELD =
  "mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";

export default function TdsSectionsForm({
  sections,
  counts,
}: {
  sections: TdsSection[];
  counts: Record<string, number>;
}) {
  const [createState, createAction, createPending] = useActionState(createTdsSection, undefined);
  const [editState, editAction, editPending] = useActionState(updateTdsSection, undefined);
  const [toggleState, toggleAction] = useActionState(setTdsSectionActive, undefined);
  const [deleteState, deleteAction] = useActionState(deleteTdsSection, undefined);
  const [editingId, setEditingId] = useState<string | null>(null);

  const status = editState ?? toggleState ?? deleteState;

  return (
    <div className="space-y-6">
      <form
        action={createAction}
        className="grid grid-cols-1 gap-3 rounded-2xl border border-zinc-200 bg-white p-6 sm:grid-cols-[7rem_1fr_7rem_auto] dark:border-zinc-800 dark:bg-zinc-900"
      >
        <div>
          <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">Section</label>
          <input name="code" required placeholder="194J" className={FIELD} />
        </div>
        <div>
          <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
            What it covers
          </label>
          <input
            name="name"
            required
            placeholder="Professional or technical services"
            className={FIELD}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">Rate %</label>
          <input
            name="rate"
            type="number"
            step="0.01"
            min="0"
            max="100"
            placeholder="10"
            className={`${FIELD} tabular-nums`}
          />
        </div>
        <div className="flex items-end">
          <button
            type="submit"
            disabled={createPending}
            className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {createPending ? "Adding…" : "Add section"}
          </button>
        </div>
        <p className="text-xs text-zinc-500 sm:col-span-4">
          The rate is optional and only pre-fills the amount for Accounts — they
          can always type a different figure, which matters when TDS is worked
          out on the value before GST.
        </p>
        {createState?.error && (
          <p className="text-xs text-red-600 sm:col-span-4 dark:text-red-400">{createState.error}</p>
        )}
        {createState?.info && (
          <p className="text-xs text-emerald-600 sm:col-span-4 dark:text-emerald-400">
            {createState.info}
          </p>
        )}
      </form>

      {status?.error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {status.error}
        </p>
      )}
      {status?.info && (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
          {status.info}
        </p>
      )}

      <ul className="space-y-2">
        {sections.map((s) => {
          const used = counts[s.id] ?? 0;
          return (
            <li
              key={s.id}
              className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
            >
              {editingId === s.id ? (
                <form
                  action={editAction}
                  onSubmit={() => setEditingId(null)}
                  className="grid grid-cols-1 gap-3 sm:grid-cols-[7rem_1fr_7rem_auto]"
                >
                  <input type="hidden" name="id" value={s.id} />
                  <input name="code" defaultValue={s.code} required className={FIELD} />
                  <input name="name" defaultValue={s.name} required className={FIELD} />
                  <input
                    name="rate"
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    defaultValue={s.rate ?? ""}
                    placeholder="—"
                    className={`${FIELD} tabular-nums`}
                  />
                  <div className="flex items-end gap-2">
                    <button
                      type="submit"
                      disabled={editPending}
                      className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="text-sm text-zinc-500 hover:underline"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <span className="rounded-md bg-zinc-100 px-2 py-0.5 font-mono text-sm font-semibold text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100">
                    {s.code}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-zinc-700 dark:text-zinc-200">
                    {s.name}
                  </span>
                  <span className="tabular-nums text-sm text-zinc-500">
                    {s.rate === null ? (
                      <span className="text-amber-600 dark:text-amber-400">rate not set</span>
                    ) : (
                      `${s.rate}%`
                    )}
                  </span>
                  {used > 0 && (
                    <span className="text-xs text-zinc-400">
                      used on {used} payment{used === 1 ? "" : "s"}
                    </span>
                  )}
                  {!s.is_active && (
                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800">
                      Off
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setEditingId(s.id)}
                    className="text-xs text-indigo-600 hover:underline dark:text-indigo-400"
                  >
                    Edit
                  </button>
                  <form action={toggleAction} className="contents">
                    <input type="hidden" name="id" value={s.id} />
                    <input type="hidden" name="is_active" value={String(!s.is_active)} />
                    <button type="submit" className="text-xs text-zinc-500 hover:underline">
                      {s.is_active ? "Turn off" : "Turn on"}
                    </button>
                  </form>
                  {/* Only offered where it is actually allowed — a delete button
                      that always answers "no" is just a trap. */}
                  {used === 0 && (
                    <form action={deleteAction} className="contents">
                      <input type="hidden" name="id" value={s.id} />
                      <button type="submit" className="text-xs text-red-600 hover:underline dark:text-red-400">
                        Delete
                      </button>
                    </form>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {sections.length === 0 && (
        <p className="rounded-xl border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
          No sections yet. Add one above and Accounts will be able to pick it.
        </p>
      )}
    </div>
  );
}
