"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { SidebarLink } from "@/components/AppShell";

/**
 * Phone navigation: a floating pill under the thumb rather than a hamburger
 * at the far top-left corner.
 *
 * The active tab is marked by a filled capsule behind its icon instead of a
 * line at the edge of the bar — at this size a 2px rule is easy to miss, and
 * the capsule reads at a glance. Five tabs is the practical maximum before
 * targets get too small; anything beyond that stays in the drawer.
 */
const MAX_TABS = 5;

export default function BottomNav({ links }: { links: SidebarLink[] }) {
  const pathname = usePathname();
  const tabs = links.slice(0, MAX_TABS);
  if (tabs.length === 0) return null;

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 sm:hidden"
      // Floats clear of the home indicator on gesture-nav phones.
      style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
    >
      <ul className="mx-3 flex items-stretch justify-around rounded-full border border-zinc-200/80 bg-white/95 px-1.5 py-1.5 shadow-xl backdrop-blur dark:border-zinc-700/80 dark:bg-zinc-900/95">
        {tabs.map((l) => {
          // /requests must not light up while on /requests/new.
          const active =
            pathname === l.href ||
            (l.href !== "/dashboard" && l.href !== "/requests/new" && pathname.startsWith(`${l.href}/`));
          return (
            <li key={l.href} className="flex-1">
              <Link
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={`flex flex-col items-center gap-0.5 rounded-full py-0.5 text-[10px] font-medium transition-colors ${
                  active
                    ? "text-zinc-900 dark:text-zinc-50"
                    : "text-zinc-500 dark:text-zinc-400"
                }`}
              >
                <span
                  className={`relative flex h-7 w-full max-w-[3.25rem] items-center justify-center rounded-full transition-colors ${
                    active ? "bg-zinc-200 dark:bg-zinc-700" : ""
                  }`}
                >
                  {l.icon}
                  {!!l.badge && l.badge > 0 && (
                    <span className="absolute -right-0.5 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white ring-2 ring-white dark:ring-zinc-900">
                      {l.badge > 99 ? "99+" : l.badge}
                    </span>
                  )}
                </span>
                <span className="truncate">{l.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
