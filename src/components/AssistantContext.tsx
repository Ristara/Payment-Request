"use client";

import { createContext, useContext, useMemo, useState } from "react";

/**
 * Ria's open/closed state, shared so the trigger doesn't have to live next to
 * the panel. On phones the bottom-right corner belongs to the tab bar and to
 * whatever Submit button a form ends with, so the trigger moves up into the
 * top bar while the panel stays where it is.
 */
type AssistantCtx = { open: boolean; setOpen: (v: boolean | ((p: boolean) => boolean)) => void };

const Ctx = createContext<AssistantCtx | null>(null);

export function AssistantProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const value = useMemo(() => ({ open, setOpen }), [open]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAssistant(): AssistantCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAssistant must be used inside <AssistantProvider>");
  return ctx;
}

/** Top-bar trigger, phones only — the desktop button still floats. */
export function AssistantTrigger() {
  const { open, setOpen } = useAssistant();
  return (
    <button
      type="button"
      onClick={() => setOpen((o) => !o)}
      aria-label={open ? "Close Ria" : "Ask Ria"}
      className="flex h-10 w-10 items-center justify-center rounded-full text-indigo-600 hover:bg-indigo-50 sm:hidden dark:text-indigo-400 dark:hover:bg-indigo-950/40"
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3l1.7 4.3L18 9l-4.3 1.7L12 15l-1.7-4.3L6 9l4.3-1.7L12 3z" />
        <path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14z" />
      </svg>
    </button>
  );
}
