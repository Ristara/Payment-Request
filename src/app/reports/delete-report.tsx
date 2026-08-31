"use client";

import { useActionState, useState } from "react";
import { deleteReport } from "./actions";

/** Two clicks, because a saved layout is easy to lose and fiddly to rebuild. */
export default function DeleteReport({ id, name }: { id: string; name: string }) {
  const [state, action, pending] = useActionState(deleteReport, undefined);
  const [confirming, setConfirming] = useState(false);

  if (state?.error) {
    return <span className="text-xs text-red-600 dark:text-red-400">{state.error}</span>;
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        Remove
      </button>
    );
  }

  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <span className="text-xs text-zinc-500">Remove {name}?</span>
      <button
        disabled={pending}
        className="rounded-md bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-60"
      >
        {pending ? "Removing…" : "Yes"}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="text-xs font-medium text-zinc-500 hover:underline"
      >
        No
      </button>
    </form>
  );
}
