"use client";

import { useActionState } from "react";
import { assignRole, createUser, removeRole } from "@/app/admin/actions";
import { ROLE_LABEL } from "@/lib/types";

type UserRow = {
  id: string;
  email: string;
  full_name: string;
  is_active: boolean;
  user_roles: { role: string }[];
};

const ROLES = ["requester", "approver", "accounts", "admin"] as const;

export default function UsersForm({ users }: { users: UserRow[] }) {
  const [createState, createAction, createPending] = useActionState(createUser, undefined);

  return (
    <div className="space-y-8">
      <form
        action={createAction}
        className="grid grid-cols-1 gap-3 rounded-2xl border border-zinc-200 bg-white p-6 sm:grid-cols-4 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <div>
          <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">Full name</label>
          <input
            name="full_name"
            required
            placeholder="Ravi Morampudi"
            className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">Email</label>
          <div className="mt-1 flex overflow-hidden rounded-md border border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900">
            <input
              name="email_local"
              required
              placeholder="ravi"
              className="flex-1 px-3 py-2 text-sm focus:outline-none dark:bg-zinc-900"
            />
            <span className="px-3 py-2 text-xs text-zinc-500 bg-zinc-100 dark:bg-zinc-800">
              @ristarafoods.com
            </span>
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">Temporary password</label>
          <input
            name="password"
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
          <p className="sm:col-span-4 text-xs text-red-600 dark:text-red-400">{createState.error}</p>
        )}
        {createState?.info && (
          <p className="sm:col-span-4 text-xs text-emerald-600 dark:text-emerald-400">{createState.info}</p>
        )}
      </form>

      <section className="rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <table className="w-full text-sm">
          <thead className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
            <tr>
              <th className="px-5 py-3">Name</th>
              <th className="px-5 py-3">Email</th>
              <th className="px-5 py-3">Roles</th>
              <th className="px-5 py-3">Assign role</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-5 py-8 text-center text-sm text-zinc-500">
                  No users yet.
                </td>
              </tr>
            ) : (
              users.map((u) => {
                const held = new Set(u.user_roles.map((r) => r.role));
                return (
                  <tr key={u.id} className="border-b border-zinc-100 last:border-b-0 dark:border-zinc-800">
                    <td className="px-5 py-3 font-medium text-zinc-900 dark:text-zinc-100">{u.full_name}</td>
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
                        {ROLES.filter((r) => !held.has(r)).map((r) => (
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
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
