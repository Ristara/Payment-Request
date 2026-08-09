"use client";

import { useEffect, useState } from "react";

export const SIDEBAR_KEY = "pay-sidebar-collapsed";

/**
 * Collapses the desktop sidebar.
 *
 * The state lives as a data attribute on <html> rather than in React, because
 * three separate elements have to react to it — the sidebar itself and the
 * left padding on both the header and the main column — and they are siblings
 * in a server component. An attribute plus two CSS rules moves all three;
 * lifting them into a client provider would turn the whole shell into a client
 * component to move some padding.
 *
 * The saved value is applied by an inline script in the root layout before
 * first paint. Doing it here in an effect would render the sidebar open and
 * then yank it shut on every single navigation.
 */
export default function SidebarToggle() {
  const [collapsed, setCollapsed] = useState(false);

  // Read what the pre-paint script already decided, so the button's label
  // starts out telling the truth.
  useEffect(() => {
    setCollapsed(document.documentElement.dataset.sidebar === "collapsed");
  }, []);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    document.documentElement.dataset.sidebar = next ? "collapsed" : "";
    try {
      localStorage.setItem(SIDEBAR_KEY, next ? "1" : "0");
    } catch {
      /* private mode — the toggle still works, it just won't be remembered */
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={collapsed}
      aria-label={collapsed ? "Show the menu" : "Hide the menu"}
      title={collapsed ? "Show the menu" : "Hide the menu"}
      className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 sm:flex dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
    >
      <svg
        width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      >
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M9 4v16" />
      </svg>
    </button>
  );
}
