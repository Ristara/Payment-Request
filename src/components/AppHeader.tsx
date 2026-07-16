import Link from "next/link";
import { signOut } from "@/app/(auth)/actions";

export type HeaderLink = { href: string; label: string };

export default function AppHeader({
  links,
  showAdmin = false,
  userName,
}: {
  links: HeaderLink[];
  showAdmin?: boolean;
  userName?: string;
}) {
  return (
    <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <div className="flex items-center gap-6">
          <Link
            href="/dashboard"
            className="text-sm font-semibold text-zinc-900 dark:text-zinc-50"
          >
            Payment Requests
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="rounded-md px-3 py-1.5 text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              >
                {l.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3 text-sm">
          {userName && (
            <span className="text-zinc-500 dark:text-zinc-400">{userName}</span>
          )}
          {showAdmin && (
            <Link
              href="/admin"
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-white hover:bg-indigo-700"
            >
              Admin
            </Link>
          )}
          <form action={signOut}>
            <button
              type="submit"
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
