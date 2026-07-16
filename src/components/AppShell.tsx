import Link from "next/link";
import MobileDrawer, { type DrawerLink } from "@/components/MobileDrawer";
import ProfileMenu from "@/components/ProfileMenu";
import SidebarNav from "@/components/SidebarNav";

export type SidebarLink = {
  href: string;
  label: string;
  icon: React.ReactNode;
  badge?: number;
};

/** Optional "switch view" pill at the bottom-left of the sidebar. */
export type SwitchViewCta = {
  href: string;
  label: string;      // e.g. "Switch to Admin View" / "Switch to My View"
  short: string;      // sidebar-friendly short label (e.g. "Admin", "My view")
  variant?: "admin" | "main";
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
  switchView,
  brand = "Ristara Foods Pvt Ltd",
  variant = "main",
  children,
}: {
  links: SidebarLink[];
  userName?: string;
  userEmail?: string;
  showAdmin?: boolean;
  unreadCount?: number;
  pageTitle?: string;
  switchView?: SwitchViewCta;
  brand?: string;
  variant?: "main" | "admin";
  children: React.ReactNode;
}) {
  const drawerLinks: DrawerLink[] = links.map((l) => ({
    href: l.href,
    label: l.label === "Requests" ? "My requests" : l.label === "Raise" ? "Raise request" : l.label === "Approve" ? "Approvals" : l.label,
    icon: l.icon,
    badge: l.badge,
  }));

  const brandBg = variant === "admin" ? "bg-amber-600" : "bg-indigo-600";
  const switchBg =
    switchView?.variant === "admin"
      ? "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
      : "border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-200";

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      {/* Desktop sidebar — Zoho Expense style: light bg, wide, icon+label rows */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-56 flex-col border-r border-slate-200 bg-white sm:flex dark:border-slate-800 dark:bg-slate-950">
        {/* Brand */}
        <Link
          href="/dashboard"
          className="flex h-14 items-center gap-2 border-b border-slate-100 px-4 dark:border-slate-800"
          title="Home"
        >
          <span className={`flex h-8 w-8 items-center justify-center rounded-md text-sm font-bold text-white ${brandBg}`}>
            R
          </span>
          <span className="truncate text-sm font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            {variant === "admin" ? "Admin" : "Payments"}
          </span>
        </Link>

        <SidebarNav links={links} />

        {/* Switch-view CTA at the bottom */}
        {switchView && (
          <div className="border-t border-slate-100 p-2 dark:border-slate-800">
            <Link
              href={switchView.href}
              className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium ${switchBg}`}
              title={switchView.label}
            >
              <SwitchIcon />
              <span className="truncate">{switchView.label}</span>
            </Link>
          </div>
        )}
      </aside>

      {/* Top bar */}
      <header className="sticky top-0 z-20 border-b border-zinc-200 bg-white sm:pl-56 dark:border-zinc-800 dark:bg-zinc-900">
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

          {/* Mobile page title (or empty spacer if no title, so the right
              group is pushed to the far edge instead of clumping left) */}
          <h1 className="flex-1 truncate text-base font-semibold text-zinc-900 sm:hidden dark:text-zinc-100">
            {pageTitle ?? ""}
          </h1>

          <div className="ml-auto flex items-center gap-2 text-right sm:ml-0 sm:text-left">
            <div className="hidden sm:block">
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {brand}
              </p>
              <p className="text-[11px] text-zinc-500">
                {variant === "admin" ? "Admin View" : "Payment Requests"}
              </p>
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
            <div className="hidden sm:block">
              <ProfileMenu userName={userName} userEmail={userEmail} isAdmin={showAdmin} switchView={switchView} />
            </div>
            {/* Mobile: still show avatar but as trigger for profile menu */}
            <div className="sm:hidden">
              <ProfileMenu userName={userName} userEmail={userEmail} isAdmin={showAdmin} switchView={switchView} />
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="sm:pl-56">
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
function SwitchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 16l-4-4 4-4" />
      <path d="M3 12h13" />
      <path d="M17 8l4 4-4 4" />
      <path d="M21 12H8" />
    </svg>
  );
}
