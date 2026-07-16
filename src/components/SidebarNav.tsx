"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";
import type { SidebarLink } from "@/components/AppShell";

/**
 * Zoho Expense-style sidebar nav — horizontal row per link, active row
 * gets a rounded light-indigo pill with indigo icon + text.
 *
 * Active-link resolution: exactly one link is active at a time. When the
 * pathname could match several links (e.g. /requests/new matches both
 * `/requests` and `/requests/new`), the one with the LONGEST matching
 * href wins — the more specific route.
 */
export default function SidebarNav({ links }: { links: SidebarLink[] }) {
  const pathname = usePathname() ?? "";
  const activeHref = useMemo(() => resolveActive(pathname, links), [pathname, links]);

  return (
    <nav className="flex-1 overflow-y-auto py-2">
      {links.map((l) => {
        const active = l.href === activeHref;
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={`mx-2 my-0.5 flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
              active
                ? "bg-indigo-50 font-medium text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-200"
                : "text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800/60"
            }`}
            title={l.label}
          >
            <span className={active ? "text-indigo-600 dark:text-indigo-300" : "text-slate-500 dark:text-slate-400"}>
              {l.icon}
            </span>
            <span className="flex-1 truncate">{l.label}</span>
            {typeof l.badge === "number" && l.badge > 0 && (
              <span
                className={`rounded-full px-1.5 text-[10px] font-semibold ${
                  active ? "bg-indigo-600 text-white" : "bg-red-500 text-white"
                }`}
              >
                {l.badge > 99 ? "99+" : l.badge}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

function resolveActive(pathname: string, links: SidebarLink[]): string | null {
  // Dashboard is special: only "/" and "/dashboard" count.
  const dashboard = links.find((l) => l.href === "/dashboard");
  if (dashboard && (pathname === "/dashboard" || pathname === "/")) {
    return dashboard.href;
  }

  // Longest-prefix wins. Exact match beats prefix match automatically because
  // an exact match has the max possible length among matching hrefs.
  let best: SidebarLink | null = null;
  for (const l of links) {
    if (l.href === "/dashboard") continue;
    if (pathname === l.href || pathname.startsWith(`${l.href}/`)) {
      if (!best || l.href.length > best.href.length) best = l;
    }
  }
  return best?.href ?? null;
}
