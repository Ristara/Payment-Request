import { signOut } from "@/app/(auth)/actions";

/**
 * Where a deactivated account lands.
 *
 * Deliberately does NOT call requireUser() — that's what redirects here, and
 * calling it would loop. The session stays valid until it expires, so this
 * page is the whole of what the account can still see.
 */
export default function DeactivatedPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 dark:bg-zinc-950">
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-8 text-center dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-950">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="text-amber-700 dark:text-amber-300">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v4" />
            <path d="M12 16h.01" />
          </svg>
        </div>
        <h1 className="mt-4 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          Your account is inactive
        </h1>
        <p className="mt-2 text-sm text-zinc-500">
          You can&apos;t sign in while it&apos;s inactive. If you think that&apos;s a mistake, ask an
          admin at Ristara Foods to make it active again.
        </p>
        <form action={signOut} className="mt-6">
          <button className="w-full rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white">
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
