"use client";

import { useActionState, useState } from "react";
import { deleteProcurementRequest } from "@/app/procurement/actions";

/**
 * Delete a dead procurement request, FROM THE LIST.
 *
 * Deliberately not on the detail page. Deleting there 404s: finishing a server
 * action makes Next re-render the route you are on, and the route you are on
 * is the request that no longer exists — notFound() fires before any redirect
 * can take you away. Redirecting from inside the action was supposed to beat
 * that and did not.
 *
 * From the list there is nothing to race. The row vanishes, the page it
 * vanishes from is still valid, and the whole class of problem goes away
 * rather than being timed around.
 */
export default function DeleteProcurement({
  id,
  number,
  stillLive = false,
}: {
  id: string;
  number: string;
  /** Not rejected or withdrawn — an admin removing something in flight. */
  stillLive?: boolean;
}) {
  const [state, action, pending] = useActionState(deleteProcurementRequest, undefined);
  const [confirming, setConfirming] = useState(false);

  if (state?.error) {
    return <span className="text-xs text-red-600 dark:text-red-400">{state.error}</span>;
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-md border border-red-200 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/40"
      >
        Delete
      </button>
    );
  }

  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <span className="text-xs text-zinc-500">
        Delete {number}?
        {stillLive && (
          <span className="block text-amber-700 dark:text-amber-400">
            Still open — whoever raised it won&rsquo;t be told.
          </span>
        )}
      </span>
      <button
        disabled={pending}
        className="rounded-md bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-60"
      >
        {pending ? "Deleting…" : "Yes"}
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
