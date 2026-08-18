"use client";

import { useActionState, useState } from "react";
import { deleteVendor } from "@/app/admin/actions";

/**
 * Delete a vendor, FROM THE LIST — admin only.
 *
 * On the list rather than the vendor's own page for the same reason the
 * procurement delete lives on its list: finishing a server action re-renders
 * the route you are on, and if that route is the record you just deleted it
 * 404s before any redirect can move you. From the list there is nothing to
 * race.
 *
 * Two clicks, and the second one names the vendor. A single Delete sitting in
 * a row of near-identical vendors is a misclick waiting to happen, and the
 * whole point of this button is tidying up rows that look alike.
 */
export default function DeleteVendor({ id, name }: { id: string; name: string }) {
  const [state, action, pending] = useActionState(deleteVendor, undefined);
  const [confirming, setConfirming] = useState(false);

  // Errors here are refusals with a reason — "on 3 payment requests" — so they
  // replace the button instead of flashing past.
  if (state?.error) {
    return (
      <span className="text-xs text-red-600 dark:text-red-400">
        {state.error}{" "}
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="underline hover:no-underline"
        >
          Dismiss
        </button>
      </span>
    );
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
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <span className="text-xs text-zinc-500">Delete {name}?</span>
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
