"use client";

import { useActionState } from "react";
import { setBranchAccess, setExpenseAccess, setModuleAccess } from "@/app/admin/actions";
import { EXPENSE_LABEL, MODULE_HINT, MODULE_LABEL, type ExpenseType, type RaiseModule } from "@/lib/access-labels";

export type Outlet = { id: string; name: string };

/**
 * What this person may RAISE for — branches, expense types, and which of the
 * two raise paths they can use.
 *
 * Only raising. What they can see, approve or pay is decided by their role and
 * isn't narrowed here, so nobody loses sight of a payment they're chasing.
 *
 * Open/closed is owned by the parent, not by this component. Each panel used
 * to hold its own flag, so every one you opened stayed open and the page grew
 * into a wall of checkboxes with no way back. One at a time, and opening
 * another closes the last.
 */
export default function AccessCell({
  userId,
  name,
  outlets,
  branchIds,
  expenseTypes,
  modules,
  isAdmin,
  open,
  onOpen,
  onClose,
}: {
  userId: string;
  name: string;
  outlets: Outlet[];
  branchIds: string[];
  expenseTypes: ExpenseType[];
  /** Which raise paths are open to them. */
  modules: RaiseModule[];
  isAdmin: boolean;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
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
            modules.length === 0 ? "text-amber-700 dark:text-amber-400" : "text-zinc-500"
          }`}
        >
          {modules.length ? modules.map((m) => MODULE_LABEL[m]).join(" · ") : "No raise path"}
        </p>
        <button
          type="button"
          onClick={onOpen}
          className="mt-1 rounded-md border border-zinc-300 px-2 py-0.5 text-[11px] text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Edit access
        </button>
      </div>
    );
  }

  const SAVE =
    "rounded-md bg-indigo-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-indigo-700 disabled:opacity-60";
  const NOTE = (s?: { info?: string; error?: string }) => (
    <>
      {s?.info && <p className="mt-1 text-[11px] text-emerald-700 dark:text-emerald-400">{s.info}</p>}
      {s?.error && <p className="mt-1 text-[11px] text-red-700 dark:text-red-400">{s.error}</p>}
    </>
  );

  return (
    <div className="w-full max-w-sm rounded-lg border border-zinc-300 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
      {/* A close control at the top, where you look first when a panel has
          opened taller than the screen. */}
      <div className="flex items-center justify-between gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <p className="truncate text-[11px] font-semibold text-zinc-700 dark:text-zinc-300">
          Access · {name}
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close access editor"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
        >
          ✕
        </button>
      </div>

      <div className="space-y-3 p-3">
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
          <button type="submit" disabled={branchPending} className={`mt-1.5 ${SAVE}`}>
            {branchPending ? "Saving…" : "Save branches"}
          </button>
          {NOTE(branchState)}
        </form>

        <form action={expAction} className="border-t border-zinc-100 pt-3 dark:border-zinc-800">
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
          <button type="submit" disabled={expPending} className={`mt-1.5 ${SAVE}`}>
            {expPending ? "Saving…" : "Save types"}
          </button>
          {NOTE(expState)}
        </form>

        <form action={modAction} className="border-t border-zinc-100 pt-3 dark:border-zinc-800">
          <input type="hidden" name="user_id" value={userId} />
          <p className="text-[11px] font-semibold text-zinc-700 dark:text-zinc-300">How they can raise</p>
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
          <button type="submit" disabled={modPending} className={`mt-1.5 ${SAVE}`}>
            {modPending ? "Saving…" : "Save raise paths"}
          </button>
          {NOTE(modState)}
        </form>
      </div>

      {/* And again at the bottom, because that is where you end up after
          ticking the last box. The old one sat in the middle of the panel,
          stranded there when a third section was added below it. */}
      <div className="border-t border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <button
          type="button"
          onClick={onClose}
          className="w-full rounded-md border border-zinc-300 py-1 text-[11px] font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Done
        </button>
      </div>
    </div>
  );
}
