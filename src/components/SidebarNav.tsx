"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { SidebarLink } from "@/components/AppShell";

/**
 * Client-side sidebar nav list — knows the current pathname so it can
 * highlight the active item (Zoho Expense style: left accent bar, filled
 * background, white text).
 */
export default function SidebarNav({ links }: { links: SidebarLink[] }) {
  const pathname = usePathname() ?? "";

  return (
    <nav className="flex flex-1 flex-col items-center gap-1">
      {links.map((l) => {
        const active = isActive(pathname, l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={`group relative flex w-16 flex-col items-center justify-center gap-1 rounded-lg py-2 transition-colors ${
              active
                ? "bg-slate-800 text-white"
                : "text-slate-400 hover:bg-slate-800/70 hover:text-white"
            }`}
            title={l.label}
          >
            {/* Left accent bar for the active item */}
            {active && (
              <span
                aria-hidden="true"
                className="absolute -left-2 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-indigo-400"
              />
            )}
            {l.icon}
            <span className="text-[10px] font-medium leading-tight">{l.label}</span>
            {typeof l.badge === "number" && l.badge > 0 && (
              <span className="absolute right-1 top-1 rounded-full bg-red-500 px-1.5 text-[9px] font-bold text-white">
                {l.badge}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Active when pathname exactly matches the link, or is a sub-route.
 * Special case: only /dashboard itself counts as active for the Home link
 * (otherwise every page would match "/").
 */
function isActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === "/dashboard" || pathname === "/";
  if (pathname === href) return true;
  return pathname.startsWith(`${href}/`);
}
