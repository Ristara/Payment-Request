"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { SidebarLink } from "@/components/AppShell";

/**
 * Zoho Expense-style sidebar nav — horizontal row per link, active row
 * gets a rounded light-indigo pill with indigo icon + text.
 */
export default function SidebarNav({ links }: { links: SidebarLink[] }) {
  const pathname = usePathname() ?? "";

  return (
    <nav className="flex-1 overflow-y-auto py-2">
      {links.map((l) => {
        const active = isActive(pathname, l.href);
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
                  active
                    ? "bg-indigo-600 text-white"
                    : "bg-red-500 text-white"
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

function isActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === "/dashboard" || pathname === "/";
  if (pathname === href) return true;
  return pathname.startsWith(`${href}/`);
}
