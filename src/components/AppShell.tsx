import Link from "next/link";
import { signOut } from "@/app/(auth)/actions";
import MobileDrawer, { type DrawerLink } from "@/components/MobileDrawer";

export type SidebarLink = {
  href: string;
  label: string;
  icon: React.ReactNode;
  badge?: number;
};

/**
 * Zoho-style app shell: dark left sidebar (desktop) with icon-first nav,
 * hamburger + slide-in drawer (mobile), top bar with search + user + notifications.
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
  const drawerLinks: DrawerLink[] = links.map((l) => ({
    href: l.href,
    label: l.label === "My" ? "My requests" : l.label === "Raise" ? "Raise request" : l.label === "Approve" ? "Approvals" : l.label === "Accts" ? "Accounts" : l.label === "Vendor" ? "Vendors" : l.label,
    icon: l.icon,
    badge: l.badge,
  }));

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      {/* Desktop sidebar */}
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
        <div className="flex items-center gap-2 px-3 py-3 sm:gap-6 sm:px-6">
          {/* Mobile hamburger + drawer */}
          <MobileDrawer
            links={drawerLinks}
            userName={userName}
            userEmail={userEmail}
            isAdmin={showAdmin}
          />

          {/* Desktop search */}
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

          {/* Mobile page title */}
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
              className="relative flex h-10 w-10 items-center justify-center rounded-full text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              title="Notifications"
            >
              <BellIcon />
              {unreadCount > 0 && (
                <span className="absolute right-1 top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white ring-2 ring-white dark:ring-zinc-900">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </Link>
            <div className="hidden h-10 w-10 items-center justify-center rounded-full bg-indigo-100 text-sm font-semibold text-indigo-700 sm:flex dark:bg-indigo-900 dark:text-indigo-200" title={userEmail}>
              {(userName ?? userEmail ?? "?").slice(0, 1).toUpperCase()}
            </div>
            <form action={signOut} className="hidden sm:block">
              <button
                type="submit"
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

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
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 8a6 6 0 0 1 12 0c0 4.418 1.5 6 2.5 7H3.5C4.5 14 6 12.418 6 8z" />
      <path d="M10.5 21a1.7 1.7 0 0 0 3 0" />
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
