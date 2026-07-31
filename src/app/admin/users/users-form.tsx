"use client";

import { useActionState, useMemo, useState } from "react";
import { assignRole, createUser, deactivateUser, reactivateUser, removeRole } from "@/app/admin/actions";
import { ROLE_LABEL, formatINR } from "@/lib/types";

type UserRow = {
  id: string;
  email: string;
  full_name: string;
  is_active: boolean;
  user_roles: { role: string }[];
};

export type OpenRequest = {
  id: string;
  requestNumber: string;
  title: string | null;
  amount: number;
  statuses: string[];
};

const ROLES = ["requester", "approver", "accounts", "admin"] as const;

export default function UsersForm({
  users,
  openByUser,
  currentUserId,
}: {
  users: UserRow[];
  openByUser: Record<string, OpenRequest[]>;
  currentUserId: string;
}) {
  const [createState, createAction, createPending] = useActionState(createUser, undefined);
  // Kept in state so a failed submit doesn't wipe what was typed.
  const [fullName, setFullName] = useState("");
  const [emailLocal, setEmailLocal] = useState("");
  const [password, setPassword] = useState("");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => {
      if (u.full_name.toLowerCase().includes(q)) return true;
      if (u.email.toLowerCase().includes(q)) return true;
      if (u.user_roles.some((r) => (ROLE_LABEL[r.role] ?? r.role).toLowerCase().includes(q))) return true;
      return false;
    });
  }, [users, query]);

  return (
    <div className="space-y-8">
      <form
        action={createAction}
        className="grid grid-cols-1 gap-3 rounded-2xl border border-zinc-200 bg-white p-6 sm:grid-cols-6 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">Full name</label>
          <input
            name="full_name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
            required
            placeholder="Ravi Morampudi"
            className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </div>
        <div className="min-w-0 sm:col-span-2">
          <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">Email</label>
          <div className="mt-1 flex overflow-hidden rounded-md border border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900">
            <input
              name="email_local"
          value={emailLocal}
          onChange={(e) => setEmailLocal(e.target.value)}
              required
              placeholder="ravi"
              className="min-w-0 flex-1 px-3 py-2 text-sm focus:outline-none dark:bg-zinc-900"
            />
            <span className="shrink-0 whitespace-nowrap bg-zinc-100 px-3 py-2 text-xs text-zinc-500 dark:bg-zinc-800">
              @ristarafoods.com
            </span>
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">Temporary password</label>
          <input
            name="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
            required
            placeholder="Min 8 chars"
            className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </div>
        <div className="flex items-end">
          <button
            type="submit"
            disabled={createPending}
            className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {createPending ? "Inviting…" : "Add user"}
          </button>
        </div>
        {createState?.error && (
          <p className="sm:col-span-6 text-xs text-red-600 dark:text-red-400">{createState.error}</p>
        )}
        {createState?.info && (
          <p className="sm:col-span-6 text-xs text-emerald-600 dark:text-emerald-400">{createState.info}</p>
        )}
      </form>

      <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center justify-between gap-3 border-b border-zinc-100 px-5 py-3 dark:border-zinc-800">
          <p className="text-xs text-zinc-500">
            {filtered.length === users.length
              ? `${users.length} user${users.length === 1 ? "" : "s"}`
              : `${filtered.length} of ${users.length}`}
          </p>
          <div className="relative w-full max-w-xs">
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
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, email, or role…"
              className="w-full rounded-md border border-zinc-200 bg-white py-1.5 pl-9 pr-8 text-sm placeholder:text-zinc-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-900"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"
              >
                ×
              </button>
            )}
          </div>
        </div>
        <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
            <tr>
              <th className="px-5 py-3">Name</th>
              <th className="px-5 py-3">Email</th>
              <th className="px-5 py-3">Roles</th>
              <th className="px-5 py-3">Assign role</th>
              <th className="px-5 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-5 py-8 text-center text-sm text-zinc-500">
                  {users.length === 0
                    ? "No users yet."
                    : `No users matching "${query}".`}
                </td>
              </tr>
            ) : (
              filtered.map((u) => {
                const held = new Set(u.user_roles.map((r) => r.role));
                return (
                  <tr
                    key={u.id}
                    className={`border-b border-zinc-100 last:border-b-0 dark:border-zinc-800 ${
                      u.is_active ? "" : "bg-zinc-50/70 dark:bg-zinc-950/40"
                    }`}
                  >
                    <td className="px-5 py-3 font-medium text-zinc-900 dark:text-zinc-100">
                      {u.full_name}
                    </td>
                    <td className="px-5 py-3 text-zinc-500">{u.email}</td>
                    <td className="px-5 py-3">
                      <div className="flex flex-wrap gap-1">
                        {u.user_roles.length === 0 ? (
                          <span className="text-xs text-zinc-500">none yet</span>
                        ) : (
                          u.user_roles.map((r) => (
                            <form key={r.role} action={removeRole} className="inline-block">
                              <input type="hidden" name="user_id" value={u.id} />
                              <input type="hidden" name="role" value={r.role} />
                              <button
                                type="submit"
                                className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-950 dark:text-indigo-200 dark:hover:bg-indigo-900"
                                title="Click to remove"
                              >
                                {ROLE_LABEL[r.role] ?? r.role} ×
                              </button>
                            </form>
                          ))
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex flex-wrap gap-1">
                        {(u.is_active ? ROLES.filter((r) => !held.has(r)) : []).map((r) => (
                          <form key={r} action={assignRole} className="inline-block">
                            <input type="hidden" name="user_id" value={u.id} />
                            <input type="hidden" name="role" value={r} />
                            <button
                              type="submit"
                              className="rounded-md border border-zinc-300 px-2 py-0.5 text-[11px] text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                            >
                              + {ROLE_LABEL[r] ?? r}
                            </button>
                          </form>
                        ))}
                      </div>
                    </td>
                    <td className="px-5 py-3 align-top">
                      <AccountCell
                        user={u}
                        open={openByUser[u.id] ?? []}
                        isSelf={u.id === currentUserId}
                      />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
          </div>
      </section>
    </div>
  );
}

/**
 * Turning an account off, and what to do with what the person left behind.
 *
 * Deactivating strips their roles, so the two questions an admin actually has
 * — "can they still get in?" and "what happens to their half-finished
 * requests?" — get answered in one place instead of being separate chores.
 */
function AccountCell({
  user,
  open,
  isSelf,
}: {
  user: UserRow;
  open: OpenRequest[];
  isSelf: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [offState, offAction, offPending] = useActionState(deactivateUser, undefined);
  const [onState, onAction, onPending] = useActionState(reactivateUser, undefined);

  if (!user.is_active) {
    return (
      <form action={onAction}>
        <input type="hidden" name="user_id" value={user.id} />
        <p className="mb-1 text-[11px] font-medium text-zinc-500">Inactive</p>
        <button
          type="submit"
          disabled={onPending}
          className="rounded-md border border-emerald-300 px-2 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-60 dark:border-emerald-900 dark:text-emerald-300 dark:hover:bg-emerald-950/40"
        >
          {onPending ? "Activating…" : "Make active"}
        </button>
        {onState?.error && <p className="mt-1 text-[11px] text-red-600">{onState.error}</p>}
      </form>
    );
  }

  if (isSelf) {
    return (
      <div>
        <p className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400">Active</p>
        <p className="text-[11px] text-zinc-400">You</p>
      </div>
    );
  }

  if (!confirming) {
    return (
      <div>
        <p className="mb-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">Active</p>
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="rounded-md border border-zinc-300 px-2 py-1 text-[11px] text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Make inactive
        </button>
        {open.length > 0 && (
          <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">
            {open.length} open request{open.length === 1 ? "" : "s"}
          </p>
        )}
        {offState?.info && (
          <p className="mt-1 text-[11px] text-emerald-700 dark:text-emerald-300">{offState.info}</p>
        )}
      </div>
    );
  }

  return (
    <form action={offAction} className="w-64 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40">
      <input type="hidden" name="user_id" value={user.id} />
      <input type="hidden" name="delete_open" value={deleteOpen ? "true" : "false"} />
      <p className="text-xs font-semibold text-amber-900 dark:text-amber-200">
        Make {user.full_name} inactive?
      </p>
      <p className="mt-1 text-[11px] text-amber-800 dark:text-amber-300">
        They won&apos;t be able to sign in, and all their roles are removed.
      </p>

      {open.length > 0 ? (
        <>
          <p className="mt-2 text-[11px] font-medium text-amber-900 dark:text-amber-200">
            {open.length} request{open.length === 1 ? "" : "s"} still in flight:
          </p>
          <ul className="mt-1 max-h-32 space-y-0.5 overflow-y-auto text-[11px] text-amber-800 dark:text-amber-300">
            {open.map((r) => (
              <li key={r.id} className="truncate">
                {r.requestNumber} · {formatINR(r.amount)}
                {r.title ? ` · ${r.title}` : ""}
              </li>
            ))}
          </ul>
          <label className="mt-2 flex items-start gap-2 text-[11px] text-amber-900 dark:text-amber-200">
            <input
              type="checkbox"
              checked={deleteOpen}
              onChange={(e) => setDeleteOpen(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              Delete these permanently. Otherwise they stay in the approval queue with nobody to
              answer for them.
            </span>
          </label>
        </>
      ) : (
        <p className="mt-2 text-[11px] text-amber-800 dark:text-amber-300">
          Nothing of theirs is in flight.
        </p>
      )}

      <input
        name="reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (optional)"
        className="mt-2 w-full rounded-md border border-amber-300 bg-white px-2 py-1 text-[11px] dark:border-amber-900 dark:bg-zinc-900"
      />

      <div className="mt-2 flex gap-2">
        <button
          type="submit"
          disabled={offPending}
          className="rounded-md bg-amber-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-amber-700 disabled:opacity-60"
        >
          {offPending ? "Saving…" : deleteOpen ? "Make inactive & delete" : "Make inactive"}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-[11px] text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
        >
          Cancel
        </button>
      </div>
      {offState?.error && (
        <p className="mt-1 text-[11px] font-medium text-red-700 dark:text-red-300">{offState.error}</p>
      )}
    </form>
  );
}
