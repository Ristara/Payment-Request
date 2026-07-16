import Link from "next/link";
import { signOut } from "@/app/(auth)/actions";

export type SidebarLink = {
  href: string;
  label: string;
  icon: React.ReactNode;
  badge?: number;
};

/**
 * Zoho-style app shell: dark left sidebar with icon-first nav, top bar
 * with search + user + notifications, and a light body.
 */
export default function AppShell({
  links,
  userName,
  userEmail,
  showAdmin,
  unreadCount = 0,
  pageTitle,
  children,
}: {
  links: SidebarLink[];
  userName?: string;
  userEmail?: string;
  showAdmin?: boolean;
  unreadCount?: number;
  pageTitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      {/* Sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-16 flex-col items-center gap-1 border-r border-slate-800 bg-slate-900 py-4 sm:flex">
        <Link
          href="/dashboard"
          className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-600 text-white"
          title="Home"
        >
          <span className="text-lg font-bold">R</span>
        </Link>
        <nav className="flex flex-1 flex-col items-center gap-1">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="group relative flex h-11 w-11 flex-col items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white"
              title={l.label}
            >
              {l.icon}
              <span className="mt-0.5 text-[9px] font-medium">{l.label.slice(0, 6)}</span>
              {typeof l.badge === "number" && l.badge > 0 && (
                <span className="absolute right-1 top-1 rounded-full bg-red-500 px-1.5 text-[9px] font-bold text-white">
                  {l.badge}
                </span>
              )}
            </Link>
          ))}
        </nav>
        {showAdmin && (
          <Link
            href="/admin"
            className="flex h-11 w-11 flex-col items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white"
            title="Admin"
          >
            <AdminIcon />
            <span className="mt-0.5 text-[9px] font-medium">Admin</span>
          </Link>
        )}
      </aside>

      {/* Top bar */}
      <header className="sticky top-0 z-20 border-b border-zinc-200 bg-white sm:pl-16 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center gap-3 px-4 py-3 sm:gap-6 sm:px-6">
          <div className="hidden flex-1 sm:block">
            <div className="relative max-w-lg">
              <SearchIcon />
              <input
                type="search"
                placeholder="Search request # / vendor / UTR…"
                className="w-full rounded-md border border-zinc-200 bg-zinc-50 py-2 pl-10 pr-3 text-sm placeholder:text-zinc-400 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-800 dark:bg-zinc-950 dark:focus:bg-zinc-900"
              />
            </div>
          </div>
          {pageTitle && (
            <h1 className="flex-1 truncate text-base font-semibold text-zinc-900 sm:hidden dark:text-zinc-100">
              {pageTitle}
            </h1>
          )}
          <div className="flex items-center gap-2 text-right sm:text-left">
            <div className="hidden sm:block">
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                Ristara Foods Pvt Ltd
              </p>
              <p className="text-[11px] text-zinc-500">Payment Requests</p>
            </div>
            <Link
              href="/notifications"
              className="relative flex h-10 w-10 items-center justify-center rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800"
              title="Notifications"
            >
              <BellIcon />
              {unreadCount > 0 && (
                <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-red-500 ring-2 ring-white dark:ring-zinc-900" />
              )}
            </Link>
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-100 text-sm font-semibold text-indigo-700 dark:bg-indigo-900 dark:text-indigo-200" title={userEmail}>
              {(userName ?? userEmail ?? "?").slice(0, 1).toUpperCase()}
            </div>
            <form action={signOut}>
              <button
                type="submit"
                className="hidden rounded-md border border-zinc-300 px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-100 sm:block dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      {/* Mobile sidebar drawer trigger */}
      <div className="sticky top-[57px] z-10 flex items-center gap-1 overflow-x-auto border-b border-zinc-200 bg-white px-3 py-2 sm:hidden dark:border-zinc-800 dark:bg-zinc-900">
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="flex flex-col items-center justify-center rounded-md px-3 py-1 text-[10px] font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            {l.label}
          </Link>
        ))}
      </div>

      {/* Main content */}
      <main className="sm:pl-16">
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-8">{children}</div>
      </main>
    </div>
  );
}

// --- Icons ---
function SearchIcon() {
  return (
    <svg
      className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <circle cx="11" cy="11" r="8" />
      <path strokeLinecap="round" d="M21 21l-4.35-4.35" />
    </svg>
  );
}
function BellIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-zinc-600 dark:text-zinc-300">
      <path d="M15 17h5l-1.4-2A7 7 0 0 0 12 3a7 7 0 0 0-6.6 12L4 17h5m6 0v1a3 3 0 0 1-6 0v-1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function AdminIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 22a8 8 0 0 1 16 0" strokeLinecap="round" />
    </svg>
  );
}
