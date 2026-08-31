"use client";

import { useActionState, useState } from "react";
import { setBranchAccess, setExpenseAccess, setModuleAccess } from "@/app/admin/actions";
import { EXPENSE_LABEL, MODULE_HINT, MODULE_LABEL, type ExpenseType, type RaiseModule } from "@/lib/access-labels";

export type Outlet = { id: string; name: string };

/**
 * What this person may RAISE for — branches and expense types.
 *
 * Only raising. What they can see, approve or pay is decided by their role
 * and isn't narrowed here, so nobody loses sight of a payment they're
 * chasing.
 *
 * Someone with no branches can't raise at all. That's deliberate rather than
 * an oversight, so the summary says so out loud instead of just showing an
 * empty list.
 */
export default function AccessCell({
  userId,
  outlets,
  branchIds,
  expenseTypes,
  modules,
  isAdmin,
}: {
  userId: string;
  outlets: Outlet[];
  branchIds: string[];
  expenseTypes: ExpenseType[];
  /** Which raise paths are open to them. */
  modules: RaiseModule[];
  isAdmin: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [branchState, branchAction, branchPending] = useActionState(setBranchAccess, undefined);
  const [expState, expAction, expPending] = useActionState(setExpenseAccess, undefined);
  const [modState, modAction, modPending] = useActionState(setModuleAccess, undefined);

  if (isAdmin) {
    return <span className="text-[11px] text-zinc-400">All (admin)</span>;
  }

  const names = outlets.filter((o) => branchIds.includes(o.id)).map((o) => o.name);
  const summary =
    branchIds.length === 0
      ? "No branches — can't raise"
      : branchIds.length === outlets.length
        ? "All branches"
        : names.join(", ");

  if (!open) {
    return (
      <div>
        <p
          className={`text-[11px] ${
            branchIds.length === 0
              ? "text-amber-700 dark:text-amber-400"
              : "text-zinc-600 dark:text-zinc-400"
          }`}
        >
          {summary}
        </p>
        <p className="text-[11px] text-zinc-500">
          {expenseTypes.length ? expenseTypes.map((t) => EXPENSE_LABEL[t]).join(" · ") : "No expense type"}
        </p>
        <p
          className={`text-[11px] ${
            modules.length === 0
              ? "text-amber-700 dark:text-amber-400"
              : "text-zinc-500"
          }`}
        >
          {modules.length ? modules.map((m) => MODULE_LABEL[m]).join(" · ") : "No raise path"}
        </p>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-1 rounded-md border border-zinc-300 px-2 py-0.5 text-[11px] text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Edit access
        </button>
      </div>
    );
  }

  return (
    <div className="w-64 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900">
      <form action={branchAction}>
        <input type="hidden" name="user_id" value={userId} />
        <p className="text-[11px] font-semibold text-zinc-700 dark:text-zinc-300">
          Branches they can raise for
        </p>
        <div className="mt-1 max-h-40 space-y-0.5 overflow-y-auto">
          {outlets.map((o) => (
            <label key={o.id} className="flex items-center gap-2 text-[11px] text-zinc-700 dark:text-zinc-300">
              <input
                type="checkbox"
                name="outlet_ids"
                value={o.id}
                defaultChecked={branchIds.includes(o.id)}
                className="h-3.5 w-3.5"
              />
              {o.name}
            </label>
          ))}
        </div>
        <button
          type="submit"
          disabled={branchPending}
          className="mt-1.5 rounded-md bg-indigo-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {branchPending ? "Saving…" : "Save branches"}
        </button>
        {branchState?.info && <p className="mt-1 text-[11px] text-emerald-700">{branchState.info}</p>}
        {branchState?.error && <p className="mt-1 text-[11px] text-red-700">{branchState.error}</p>}
      </form>

      <form action={expAction} className="mt-3 border-t border-zinc-100 pt-2 dark:border-zinc-800">
        <input type="hidden" name="user_id" value={userId} />
        <p className="text-[11px] font-semibold text-zinc-700 dark:text-zinc-300">Expense types</p>
        <div className="mt-1 flex gap-3">
          {(["capex", "opex"] as const).map((t) => (
            <label key={t} className="flex items-center gap-1.5 text-[11px] text-zinc-700 dark:text-zinc-300">
              <input
                type="checkbox"
                name="expense_types"
                value={t}
                defaultChecked={expenseTypes.includes(t)}
                className="h-3.5 w-3.5"
              />
              {EXPENSE_LABEL[t]}
            </label>
          ))}
        </div>
        <div className="mt-1.5 flex gap-2">
          <button
            type="submit"
            disabled={expPending}
            className="rounded-md bg-indigo-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {expPending ? "Saving…" : "Save types"}
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-md border border-zinc-300 px-2 py-1 text-[11px] text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
          >
            Done
          </button>
        </div>
        {expState?.info && <p className="mt-1 text-[11px] text-emerald-700">{expState.info}</p>}
        {expState?.error && <p className="mt-1 text-[11px] text-red-700">{expState.error}</p>}
      </form>

      <form action={modAction} className="mt-3 border-t border-zinc-100 pt-2 dark:border-zinc-800">
        <input type="hidden" name="user_id" value={userId} />
        <p className="text-[11px] font-semibold text-zinc-700 dark:text-zinc-300">
          How they can raise
        </p>
        <div className="mt-1 space-y-1">
          {(["payment", "procurement"] as const).map((m) => (
            <label key={m} className="flex items-start gap-1.5 text-[11px] text-zinc-700 dark:text-zinc-300">
              <input
                type="checkbox"
                name="modules"
                value={m}
                defaultChecked={modules.includes(m)}
                className="mt-0.5 h-3.5 w-3.5"
              />
              <span>
                {MODULE_LABEL[m]}
                <span className="block text-[10px] text-zinc-500">{MODULE_HINT[m]}</span>
              </span>
            </label>
          ))}
        </div>
        <button
          type="submit"
          disabled={modPending}
          className="mt-1.5 rounded-md bg-indigo-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {modPending ? "Saving…" : "Save raise paths"}
        </button>
        {modState?.info && <p className="mt-1 text-[11px] text-emerald-700">{modState.info}</p>}
        {modState?.error && <p className="mt-1 text-[11px] text-red-700">{modState.error}</p>}
      </form>
    </div>
  );
}
