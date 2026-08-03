"use client";

import { useActionState, useState } from "react";
import { addWatcher, removeWatcher } from "@/app/requests/actions";

export type CcPerson = { id: string; full_name: string };

/**
 * Who else can see this request, and a way to change it.
 *
 * CC used to be answerable only at the moment of raising. After that the list
 * was invisible and fixed: nobody could see who had been looped in, and
 * looping in one more person meant raising the request again.
 *
 * The list is shown even when it is empty and even to people who cannot change
 * it, because "who can see this payment" is worth knowing on its own.
 */
export default function CcPanel({
  requestId,
  watchers,
  candidates,
  canEdit,
}: {
  requestId: string;
  watchers: CcPerson[];
  candidates: CcPerson[];
  canEdit: boolean;
}) {
  const [addState, add, adding] = useActionState(addWatcher, undefined);
  const [removeState, remove, removing] = useActionState(removeWatcher, undefined);
  const [picked, setPicked] = useState("");

  const already = new Set(watchers.map((w) => w.id));
  const addable = candidates.filter((c) => !already.has(c.id));
  const msg = addState?.info || removeState?.info;
  const err = addState?.error || removeState?.error;

  return (
    <div>
      {watchers.length === 0 ? (
        <p className="text-sm text-zinc-500">Nobody else has been CC&rsquo;d.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {watchers.map((w) => (
            <li
              key={w.id}
              className="inline-flex items-center gap-1 rounded-full bg-zinc-100 py-1 pl-3 pr-1 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
            >
              {w.full_name}
              {canEdit && (
                <form action={remove} className="contents">
                  <input type="hidden" name="request_id" value={requestId} />
                  <input type="hidden" name="user_id" value={w.id} />
                  <button
                    disabled={removing}
                    aria-label={`Remove ${w.full_name} from CC`}
                    title={`Remove ${w.full_name}`}
                    className="flex h-4 w-4 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-300 hover:text-zinc-900 disabled:opacity-50 dark:hover:bg-zinc-600 dark:hover:text-white"
                  >
                    ×
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && addable.length > 0 && (
        <form action={add} className="mt-3 flex items-center gap-2">
          <input type="hidden" name="request_id" value={requestId} />
          <select
            name="user_id"
            value={picked}
            onChange={(e) => setPicked(e.target.value)}
            required
            aria-label="Person to CC"
            className="min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-950"
          >
            <option value="">Add someone…</option>
            {addable.map((c) => (
              <option key={c.id} value={c.id}>
                {c.full_name}
              </option>
            ))}
          </select>
          <button
            disabled={adding || !picked}
            className="shrink-0 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {adding ? "Adding…" : "CC"}
          </button>
        </form>
      )}

      {canEdit && (
        <p className="mt-2 text-[11px] text-zinc-500">
          A CC&rsquo;d person can open this request and everything on it.
        </p>
      )}

      {msg && <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-300">{msg}</p>}
      {err && <p className="mt-2 text-xs text-red-700 dark:text-red-300">{err}</p>}
    </div>
  );
}
