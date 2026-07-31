"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { SidebarLink } from "@/components/AppShell";

/**
 * Phone navigation: a thumb-reachable tab bar instead of a hamburger.
 *
 * Most journeys here are "check what's waiting for me" on a phone between
 * other things, and a drawer costs two taps at the far top-left corner. Five
 * tabs is the practical maximum before targets get too small; anything beyond
 * that stays in the drawer.
 */
const MAX_TABS = 5;

export default function BottomNav({ links }: { links: SidebarLink[] }) {
  const pathname = usePathname();
  const tabs = links.slice(0, MAX_TABS);
  if (tabs.length === 0) return null;

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-zinc-200 bg-white/95 backdrop-blur sm:hidden dark:border-zinc-800 dark:bg-zinc-900/95"
      // Sits above the home indicator on gesture-nav phones.
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="flex">
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
                className={`relative flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition-colors ${
                  active
                    ? "text-indigo-600 dark:text-indigo-400"
                    : "text-zinc-500 dark:text-zinc-400"
                }`}
              >
                <span className="relative">
                  {l.icon}
                  {!!l.badge && l.badge > 0 && (
                    <span className="absolute -right-2 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
                      {l.badge > 99 ? "99+" : l.badge}
                    </span>
                  )}
                </span>
                <span className="truncate">{l.label}</span>
                {active && (
                  <span className="absolute inset-x-3 top-0 h-0.5 rounded-full bg-indigo-600 dark:bg-indigo-400" />
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
