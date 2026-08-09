"use client";

import { useEffect, useState } from "react";

export const SIDEBAR_KEY = "pay-sidebar-collapsed";

/**
 * Collapses the sidebar to an icon rail.
 *
 * It shrinks rather than disappears, which matters: the button that brings it
 * back rides in the rail, so there is never a state where the only control is
 * hidden. The first attempt hid the sidebar outright and put a small icon in
 * the top bar, which the owner could not pick out.
 *
 * The state is a data attribute on <html>, not React state — the sidebar, the
 * nav labels, and the left padding on both the header and the main column all
 * have to react to it, and they are spread across a server component. The
 * saved value is applied by an inline script before first paint so the menu
 * never renders wide and then jumps narrow.
 */
export default function SidebarToggle() {
  const [collapsed, setCollapsed] = useState(false);

  // Read what the pre-paint script already decided, so the chevron starts out
  // pointing the right way.
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
      aria-label={collapsed ? "Widen the menu" : "Collapse the menu"}
      title={collapsed ? "Widen the menu" : "Collapse the menu"}
      className="flex w-full items-center justify-center rounded-xl border-2 border-indigo-600 px-3 py-2.5 text-indigo-600 transition-colors hover:bg-indigo-50 dark:border-indigo-500 dark:text-indigo-400 dark:hover:bg-indigo-950/40"
    >
      {/* Rotated rather than swapped for a second path: one element, and the
          turn makes the direction obvious even mid-animation. */}
      <svg
        width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
        className={collapsed ? "rotate-180 transition-transform" : "transition-transform"}
      >
        <path d="M15 18l-6-6 6-6" />
      </svg>
    </button>
  );
}
