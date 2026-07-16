"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { signOut } from "@/app/(auth)/actions";

export type DrawerLink = {
  href: string;
  label: string;
  icon: React.ReactNode;
  badge?: number;
};

/**
 * Zoho-style mobile slide-in drawer.
 * Contains user profile at top, then a vertical list of nav links
 * with icons + labels + badge counts, then a Sign out button.
 */
export default function MobileDrawer({
  links,
  userName,
  userEmail,
  isAdmin,
  brand = "Ristara Foods Pvt Ltd",
  role = "Payment Requests",
  switchView,
  variant = "main",
}: {
  links: DrawerLink[];
  userName?: string;
  userEmail?: string;
  isAdmin?: boolean;
  brand?: string;
  role?: string;
  switchView?: { href: string; label: string; variant?: "admin" | "main" };
  variant?: "main" | "admin";
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Close the drawer whenever the user taps a link (route change).
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Lock body scroll when the drawer is open.
  useEffect(() => {
    if (open) {
      const original = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = original; };
    }
  }, [open]);

  return (
    <>
      {/* Hamburger button — only visible on mobile */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        className="flex h-10 w-10 items-center justify-center rounded-md text-zinc-700 hover:bg-zinc-100 sm:hidden dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="4" y1="7" x2="20" y2="7" />
          <line x1="4" y1="12" x2="20" y2="12" />
          <line x1="4" y1="17" x2="20" y2="17" />
        </svg>
      </button>

      {/* Backdrop */}
      <div
        onClick={() => setOpen(false)}
        aria-hidden="true"
        className={`fixed inset-0 z-40 bg-black/40 transition-opacity duration-200 sm:hidden ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />

      {/* Drawer panel */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col bg-white shadow-2xl transition-transform duration-250 sm:hidden dark:bg-zinc-900 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
        aria-hidden={!open}
      >
        {/* Profile header */}
        <div className="border-b border-zinc-100 px-5 pt-6 pb-5 dark:border-zinc-800">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-indigo-100 text-lg font-semibold text-indigo-700 dark:bg-indigo-900 dark:text-indigo-200">
              {(userName ?? userEmail ?? "?").slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-semibold text-zinc-900 dark:text-zinc-50">
                {userName ?? "You"}
              </p>
              <p className="truncate text-xs text-zinc-500">{userEmail}</p>
            </div>
          </div>

          {/* Org / role chip */}
          <div className="mt-4 flex items-center gap-2 rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-800/50">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-white text-indigo-600 dark:bg-zinc-900">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 21h18M5 21V7l7-4 7 4v14M9 9h.01M9 12h.01M9 15h.01M15 9h.01M15 12h.01M15 15h.01" />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-zinc-900 dark:text-zinc-100">{brand}</p>
              <p className="truncate text-[10px] text-zinc-500">{isAdmin ? "Admin" : role}</p>
            </div>
          </div>
        </div>

        {/* Nav links */}
        <nav className="flex-1 overflow-y-auto py-2">
          {links.map((l) => {
            const active = pathname === l.href || (l.href !== "/dashboard" && pathname?.startsWith(l.href));
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`mx-3 my-0.5 flex items-center gap-3 rounded-md px-3 py-2.5 text-sm ${
                  active
                    ? "bg-indigo-600 font-medium text-white"
                    : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                }`}
              >
                <span className={active ? "text-white" : "text-zinc-500"}>{l.icon}</span>
                <span className="flex-1">{l.label}</span>
                {typeof l.badge === "number" && l.badge > 0 && (
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    active
                      ? "bg-white/25 text-white"
                      : "bg-red-500 text-white"
                  }`}>
                    {l.badge > 99 ? "99+" : l.badge}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Switch-view CTA + Sign out */}
        <div className="border-t border-zinc-100 p-3 dark:border-zinc-800 space-y-1">
          {switchView && (
            <Link
              href={switchView.href}
              className={`flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-white ${
                switchView.variant === "admin"
                  ? "bg-amber-600 hover:bg-amber-700"
                  : "bg-indigo-600 hover:bg-indigo-700"
              }`}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 16l-4-4 4-4M3 12h13M17 8l4 4-4 4M21 12H8" />
              </svg>
              {switchView.label}
            </Link>
          )}
          <form action={signOut}>
            <button
              type="submit"
              className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <path d="M16 17l5-5-5-5M21 12H9" />
              </svg>
              Sign out
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}
