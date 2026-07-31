"use client";

import { useFormStatus } from "react-dom";

/**
 * Download button that goes dead while the request is in flight.
 *
 * A download response doesn't navigate the page, so nothing about the form
 * changes when it completes — without this, a second click looks like the
 * obvious thing to do when the file takes a moment, and each click is a
 * separate batch attempt.
 */
function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
    >
      {pending ? "Building…" : "Download bank file"}
    </button>
  );
}

export default function DownloadBankFile({ disabled }: { disabled: boolean }) {
  return (
    <form action="/api/bank-file" method="post" className="flex shrink-0 items-center gap-2">
      <label className="sr-only" htmlFor="bank">
        Pay from
      </label>
      <select
        id="bank"
        name="bank"
        defaultValue="kotak"
        disabled={disabled}
        className="rounded-md border border-indigo-300 bg-white px-2 py-2 text-sm text-indigo-900 disabled:opacity-50 dark:border-indigo-800 dark:bg-zinc-900 dark:text-indigo-100"
      >
        <option value="kotak">Kotak</option>
        <option value="icici">ICICI</option>
      </select>
      <SubmitButton disabled={disabled} />
    </form>
  );
}
