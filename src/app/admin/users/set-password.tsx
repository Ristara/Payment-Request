"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { setUserPassword } from "@/app/admin/actions";

/**
 * Set a user's password from the admin page.
 *
 * Collapsed by default. Two password boxes rather than one, because the admin
 * types a value the other person has to be told verbatim — a typo here means
 * locking someone out and not knowing it until they ring you.
 *
 * The value is never shown back after saving. It is in the admin's head and in
 * the box they just typed it into; putting it in a success message would leave
 * it in screenshots and scrollback.
 */
export default function SetPassword({
  userId,
  name,
  isSelf,
}: {
  userId: string;
  name: string;
  isSelf: boolean;
}) {
  const [state, action, pending] = useActionState(setUserPassword, undefined);
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.info) {
      setOpen(false);
      // Don't leave the typed password sitting in the DOM once it has landed.
      formRef.current?.reset();
    }
  }, [state?.info]);

  if (!open) {
    return (
      <div className="mt-3">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
        >
          Set password
        </button>
        {state?.info && (
          <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">{state.info}</p>
        )}
      </div>
    );
  }

  return (
    <form
      ref={formRef}
      action={action}
      className="mt-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-950/40"
    >
      <input type="hidden" name="user_id" value={userId} />
      <p className="text-xs text-zinc-500">
        {isSelf
          ? "Setting your own password. You'll stay signed in here."
          : `Setting a new password for ${name}. Tell them yourself — nothing is emailed.`}
      </p>
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <input
          type="password"
          name="password"
          required
          minLength={8}
          autoComplete="new-password"
          placeholder="New password (min 8)"
          className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        <input
          type="password"
          name="confirm"
          required
          minLength={8}
          autoComplete="new-password"
          placeholder="Type it again"
          className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {pending ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={() => {
              formRef.current?.reset();
              setOpen(false);
            }}
            className="text-xs font-medium text-zinc-500 hover:underline"
          >
            Cancel
          </button>
        </div>
      </div>
      {state?.error && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">{state.error}</p>
      )}
    </form>
  );
}
