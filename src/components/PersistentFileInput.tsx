"use client";

import { useEffect, useId, useRef, useState } from "react";

/**
 * A file picker that survives a form reset, and looks like part of the app.
 *
 * React resets the whole form when a server action runs, which empties file
 * inputs. On a validation error that means the user's chosen files are gone
 * with no visible sign, so a retry silently submits nothing. A file input's
 * value can't be set from a React value prop, so the selection is kept in
 * state and re-applied through a DataTransfer whenever the form resets.
 *
 * The native control is kept in the DOM — it is what actually carries the
 * files to the server, and what the reset trick writes back into — but it is
 * visually hidden behind a label. "Choose files / No file chosen" is the
 * browser's own rendering, unstyleable and unlike anything else on the page.
 */
export default function PersistentFileInput({
  name,
  multiple = false,
  accept,
  className,
  required = false,
  label,
}: {
  name: string;
  multiple?: boolean;
  accept?: string;
  /** Kept for callers that still pass one; the wrapper is styled either way. */
  className?: string;
  required?: boolean;
  /** Overrides the default prompt, e.g. "Attach the invoice". */
  label?: string;
}) {
  const ref = useRef<HTMLInputElement | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const id = useId();

  useEffect(() => {
    const input = ref.current;
    const form = input?.form;
    if (!input || !form) return;
    const reapply = () => {
      // Let React finish its reset before putting the files back.
      queueMicrotask(() => {
        if (!ref.current) return;
        const dt = new DataTransfer();
        files.forEach((f) => dt.items.add(f));
        ref.current.files = dt.files;
      });
    };
    form.addEventListener("reset", reapply);
    return () => form.removeEventListener("reset", reapply);
  }, [files]);

  /** Writes into the real input too, so the form still submits them. */
  function accept_(list: FileList | null) {
    const picked = Array.from(list ?? []);
    if (picked.length === 0) return;
    const next = multiple ? [...files, ...picked] : picked.slice(0, 1);
    setFiles(next);
    if (ref.current) {
      const dt = new DataTransfer();
      next.forEach((f) => dt.items.add(f));
      ref.current.files = dt.files;
    }
  }

  function removeAt(i: number) {
    const next = files.filter((_, n) => n !== i);
    setFiles(next);
    if (ref.current) {
      const dt = new DataTransfer();
      next.forEach((f) => dt.items.add(f));
      ref.current.files = dt.files;
    }
  }

  const prompt = label ?? (multiple ? "Add files" : "Choose a file");

  return (
    <div className={className}>
      <input
        ref={ref}
        id={id}
        type="file"
        name={name}
        multiple={multiple}
        accept={accept}
        // Only required until something is chosen — the native input is empty
        // on the very first render even when files are in state after a reset.
        required={required && files.length === 0}
        onChange={(e) => accept_(e.target.files)}
        className="sr-only"
      />

      <label
        htmlFor={id}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          accept_(e.dataTransfer.files);
        }}
        className={
          dragging
            ? "flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed border-indigo-500 bg-indigo-50 px-4 py-3 dark:bg-indigo-950/40"
            : "flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed border-zinc-300 px-4 py-3 hover:border-indigo-400 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800/50"
        }
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-300">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 16V4" />
            <path d="M8 8l4-4 4 4" />
            <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
          </svg>
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-medium text-zinc-800 dark:text-zinc-100">{prompt}</span>
          <span className="block text-xs text-zinc-500">
            Tap to browse, or drop {multiple ? "files" : "a file"} here
          </span>
        </span>
      </label>

      {files.length > 0 && (
        <ul className="mt-2 space-y-1">
          {files.map((f, i) => (
            <li
              key={`${f.name}-${i}`}
              className="flex items-center justify-between gap-2 rounded-lg bg-zinc-50 px-3 py-1.5 text-xs dark:bg-zinc-800/60"
            >
              <span className="truncate text-zinc-700 dark:text-zinc-200">{f.name}</span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="tabular-nums text-zinc-400">
                  {Math.max(1, Math.round(f.size / 1024))} KB
                </span>
                {/* Removable, because the browser's control never was: picking
                    again replaced the lot, so one wrong file meant redoing all
                    of them. */}
                <button
                  type="button"
                  onClick={() => removeAt(i)}
                  aria-label={`Remove ${f.name}`}
                  className="flex h-4 w-4 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-300 hover:text-zinc-900 dark:hover:bg-zinc-600 dark:hover:text-white"
                >
                  ×
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
