"use client";

import { useActionState, useEffect, useState } from "react";
import { deleteReport, renameReport } from "./actions";

/**
 * Rename and Remove for one saved report.
 *
 * One component rather than two so the row can only be in one state at a
 * time — a rename box open next to a "Remove this?" prompt is a good way to
 * answer the wrong question.
 */
export default function ReportActions({ id, name }: { id: string; name: string }) {
  const [mode, setMode] = useState<null | "rename" | "delete">(null);
  const [renameState, renameAction, renamePending] = useActionState(renameReport, undefined);
  const [deleteState, deleteAction, deletePending] = useActionState(deleteReport, undefined);

  useEffect(() => {
    if (renameState?.info) setMode(null);
  }, [renameState?.info]);

  const err = renameState?.error ?? deleteState?.error;

  if (mode === "rename") {
    return (
      <form action={renameAction} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="id" value={id} />
        <input
          name="name"
          defaultValue={name}
          required
          maxLength={80}
          autoFocus
          aria-label="New name"
          className="w-56 rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button
          disabled={renamePending}
          className="rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {renamePending ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => setMode(null)}
          className="text-xs font-medium text-zinc-500 hover:underline"
        >
          Cancel
        </button>
        {err && <span className="w-full text-xs text-red-600 dark:text-red-400">{err}</span>}
      </form>
    );
  }

  if (mode === "delete") {
    return (
      <form action={deleteAction} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="id" value={id} />
        <span className="text-xs text-zinc-500">Remove {name}?</span>
        <button
          disabled={deletePending}
          className="rounded-md bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-60"
        >
          {deletePending ? "Removing…" : "Yes"}
        </button>
        <button
          type="button"
          onClick={() => setMode(null)}
          className="text-xs font-medium text-zinc-500 hover:underline"
        >
          No
        </button>
        {err && <span className="w-full text-xs text-red-600 dark:text-red-400">{err}</span>}
      </form>
    );
  }

  return (
    <div className="flex items-center gap-3">
      {err && <span className="text-xs text-red-600 dark:text-red-400">{err}</span>}
      <button
        type="button"
        onClick={() => setMode("rename")}
        className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
      >
        Rename
      </button>
      <button
        type="button"
        onClick={() => setMode("delete")}
        className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        Remove
      </button>
    </div>
  );
}
