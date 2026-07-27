"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A file input that survives a form reset.
 *
 * React resets the whole form when a server action runs, which empties file
 * inputs. On a validation error that means the user's chosen files are gone
 * with no visible sign, so a retry silently submits nothing. A file input's
 * value can't be set from a React value prop, so the selection is kept in
 * state and re-applied through a DataTransfer whenever the form resets.
 */
export default function PersistentFileInput({
  name,
  multiple = false,
  accept,
  className,
  required = false,
}: {
  name: string;
  multiple?: boolean;
  accept?: string;
  className?: string;
  required?: boolean;
}) {
  const ref = useRef<HTMLInputElement | null>(null);
  const [files, setFiles] = useState<File[]>([]);

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

  return (
    <>
      <input
        ref={ref}
        type="file"
        name={name}
        multiple={multiple}
        accept={accept}
        required={required}
        onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
        className={className}
      />
      {files.length > 0 && (
        <p className="mt-1 text-[11px] text-zinc-500">
          {files.length === 1 ? files[0].name : `${files.length} files selected`}
        </p>
      )}
    </>
  );
}
