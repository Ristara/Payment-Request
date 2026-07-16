"use client";

import { useActionState } from "react";
import { createOutlet, toggleOutletActive } from "@/app/admin/actions";

type Outlet = {
  id: string;
  code: string;
  name: string;
  cost_centre: string | null;
  is_active: boolean;
};

export default function OutletsForm({ outlets }: { outlets: Outlet[] }) {
  const [state, formAction, pending] = useActionState(createOutlet, undefined);

  return (
    <div className="space-y-6">
      <form
        action={formAction}
        className="grid grid-cols-1 gap-3 rounded-2xl border border-zinc-200 bg-white p-6 sm:grid-cols-4 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <div>
          <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">Code</label>
          <input
            name="code"
            required
            placeholder="HSR"
            className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">Name</label>
          <input
            name="name"
            required
            placeholder="Babai Tiffins HSR"
            className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">Cost centre (optional)</label>
          <input
            name="cost_centre"
            placeholder="CC-HSR"
            className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </div>
        <div className="flex items-end">
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {pending ? "Adding…" : "Add outlet"}
          </button>
        </div>
        {state?.error && (
          <p className="sm:col-span-4 text-xs text-red-600 dark:text-red-400">{state.error}</p>
        )}
        {state?.info && (
          <p className="sm:col-span-4 text-xs text-emerald-600 dark:text-emerald-400">{state.info}</p>
        )}
      </form>

      <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
            <tr>
              <th className="px-5 py-3">Code</th>
              <th className="px-5 py-3">Name</th>
              <th className="px-5 py-3">Cost centre</th>
              <th className="px-5 py-3">Status</th>
              <th className="px-5 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {outlets.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-5 py-8 text-center text-sm text-zinc-500">
                  No outlets yet. Add your first above.
                </td>
              </tr>
            ) : (
              outlets.map((o) => (
                <tr key={o.id} className="border-b border-zinc-100 last:border-b-0 dark:border-zinc-800">
                  <td className="px-5 py-3 font-mono text-xs">{o.code}</td>
                  <td className="px-5 py-3">{o.name}</td>
                  <td className="px-5 py-3 text-zinc-500">{o.cost_centre ?? "—"}</td>
                  <td className="px-5 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        o.is_active
                          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200"
                          : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                      }`}
                    >
                      {o.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <form action={toggleOutletActive}>
                      <input type="hidden" name="id" value={o.id} />
                      <input type="hidden" name="is_active" value={o.is_active ? "false" : "true"} />
                      <button
                        type="submit"
                        className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                      >
                        {o.is_active ? "Deactivate" : "Reactivate"}
                      </button>
                    </form>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
          </div>
      </section>
    </div>
  );
}
