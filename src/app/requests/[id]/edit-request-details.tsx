"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { updateRequestDetails } from "@/app/requests/actions";
import CoaCascade, { type CoaAccount, type CoaSelection } from "@/components/CoaCascade";
import { COA_LABEL, COA_PATH } from "@/lib/coa-labels";

export type OutletOption = { id: string; name: string; stage: string };

/**
 * Edit the top of a request after it has been raised.
 *
 * Deliberately the same four choices, in the same order, with the same rules
 * as the Raise form — OpEx implies an operational outlet, the outlet list is
 * filtered by what the payment is for, and switching CapEx/OpEx resets the
 * account because the two charts do not overlap. An edit screen that quietly
 * allowed a combination the raise screen forbids is how bad data gets in
 * through the back door.
 */
export default function EditRequestDetails({
  requestId,
  title,
  expenseType,
  paymentKind,
  outletId,
  outlets,
  coaAccounts,
}: {
  requestId: string;
  title: string;
  expenseType: "capex" | "opex";
  paymentKind: "regular" | "milestone";
  outletId: string | null;
  outlets: OutletOption[];
  coaAccounts: CoaAccount[];
}) {
  const [open, setOpen] = useState(false);

  // The form lives in its own component so every field resets to the saved
  // values each time the panel is reopened — abandoning a half-made edit and
  // coming back should not show the abandoned state.
  return (
    <div className="mt-3">
      {open ? (
        <Panel
          requestId={requestId}
          title={title}
          expenseType={expenseType}
          paymentKind={paymentKind}
          outletId={outletId}
          outlets={outlets}
          coaAccounts={coaAccounts}
          onClose={() => setOpen(false)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          Edit request details
        </button>
      )}
    </div>
  );
}

function Panel({
  requestId,
  title,
  expenseType,
  paymentKind,
  outletId,
  outlets,
  coaAccounts,
  onClose,
}: {
  requestId: string;
  title: string;
  expenseType: "capex" | "opex";
  paymentKind: "regular" | "milestone";
  outletId: string | null;
  outlets: OutletOption[];
  coaAccounts: CoaAccount[];
  onClose: () => void;
}) {
  const [state, formAction, pending] = useActionState(updateRequestDetails, undefined);

  const [expense, setExpense] = useState<"capex" | "opex">(expenseType);
  const [kind, setKind] = useState<"regular" | "milestone">(paymentKind);
  const startingStage = outlets.find((o) => o.id === outletId)?.stage ?? "";
  const [storeType, setStoreType] = useState<string>(startingStage);
  const [outlet, setOutlet] = useState<string>(outletId ?? "");
  const [coa, setCoa] = useState<CoaSelection>({ coa: "", category: "", accountId: "" });

  // OpEx never asks "new store or existing outlet" — it is always operational.
  const effectiveStage = expense === "opex" ? "operational" : storeType;
  const visibleOutlets = useMemo(
    () => (effectiveStage ? outlets.filter((o) => o.stage === effectiveStage) : []),
    [outlets, effectiveStage],
  );

  const expenseChanged = expense !== expenseType;

  useEffect(() => {
    if (state?.info) onClose();
  }, [state?.info, onClose]);

  function chooseExpense(next: "capex" | "opex") {
    if (next === expense) return;
    setExpense(next);
    // The account belongs to the old chart, and the outlet may belong to a
    // stage the new type does not allow. Both are cleared rather than left
    // looking valid.
    setCoa({ coa: "", category: "", accountId: "" });
    if (next === "opex") {
      setStoreType("operational");
      if (outlets.find((o) => o.id === outlet)?.stage !== "operational") setOutlet("");
    } else {
      setStoreType(startingStage);
      setOutlet(outletId ?? "");
    }
  }

  const BTN = (active: boolean) =>
    active
      ? "rounded-xl border-2 border-indigo-600 bg-indigo-50 px-3 py-2 text-left dark:bg-indigo-950/40"
      : "rounded-xl border border-zinc-200 px-3 py-2 text-left hover:border-zinc-300 dark:border-zinc-800";

  return (
    <form
      action={formAction}
      className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <input type="hidden" name="request_id" value={requestId} />
      <input type="hidden" name="expense_type" value={expense} />
      <input type="hidden" name="payment_kind" value={kind} />

      <div className="space-y-4">
        <div>
          <span className="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300">
            Expense type
          </span>
          <div className="grid grid-cols-2 gap-2">
            {(["capex", "opex"] as const).map((k) => (
              <button type="button" key={k} onClick={() => chooseExpense(k)} className={BTN(expense === k)}>
                <span className="block text-sm font-semibold">{k === "capex" ? "CapEx" : "OpEx"}</span>
                <span className="block text-xs text-zinc-500">
                  {k === "capex" ? "Assets & construction" : "Rent & utilities"}
                </span>
              </button>
            ))}
          </div>
        </div>

        {expense === "capex" && (
          <div>
            <span className="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300">
              What is this payment for?
            </span>
            <div className="grid grid-cols-2 gap-2">
              {([
                { k: "upcoming", title: "New Store", hint: "Upcoming outlet" },
                { k: "operational", title: "Existing Outlet", hint: "Operational outlet" },
              ] as const).map((o) => (
                <button
                  type="button"
                  key={o.k}
                  onClick={() => {
                    setStoreType(o.k);
                    // The outlet list is about to change under it.
                    if (outlets.find((x) => x.id === outlet)?.stage !== o.k) setOutlet("");
                  }}
                  className={BTN(storeType === o.k)}
                >
                  <span className="block text-sm font-semibold">{o.title}</span>
                  <span className="block text-xs text-zinc-500">{o.hint}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <span className="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300">
            Payment kind
          </span>
          <div className="grid grid-cols-2 gap-2">
            {([
              { k: "regular", title: "Regular", hint: "One-off / part payments" },
              { k: "milestone", title: "Milestone", hint: "Project milestones" },
            ] as const).map((o) => (
              <button type="button" key={o.k} onClick={() => setKind(o.k)} className={BTN(kind === o.k)}>
                <span className="block text-sm font-semibold">{o.title}</span>
                <span className="block text-xs text-zinc-500">{o.hint}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label htmlFor="edit-title" className="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300">
            Payment request title
          </label>
          <input
            id="edit-title"
            name="title"
            required
            maxLength={140}
            defaultValue={title}
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          />
        </div>

        <div>
          <label htmlFor="edit-outlet" className="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300">
            Outlet
          </label>
          <select
            id="edit-outlet"
            name="outlet_id"
            required
            value={outlet}
            onChange={(e) => setOutlet(e.target.value)}
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          >
            <option value="" disabled>
              {effectiveStage ? "Choose an outlet…" : "Choose New Store / Existing Outlet first…"}
            </option>
            {visibleOutlets.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </div>

        {/* Only when the chart has actually changed. Asking for the account
            again on every edit would make a title fix into a re-coding job. */}
        {expenseChanged && (
          <div>
            <span className="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300">
              {expense === "opex" ? `${COA_LABEL.level1} · ${COA_LABEL.level3}` : COA_PATH}
            </span>
            <p className="mb-2 text-xs text-amber-700 dark:text-amber-400">
              CapEx and OpEx have separate charts, so the account picked before
              doesn&rsquo;t exist under {expense === "opex" ? "OpEx" : "CapEx"}. Choose it again.
            </p>
            <CoaCascade
              accounts={coaAccounts.filter((a) => a.expense_type === expense)}
              value={coa}
              onChange={setCoa}
              isOpex={expense === "opex"}
              required
            />
          </div>
        )}
      </div>

      {state?.error && (
        <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {state.error}
        </p>
      )}

      <div className="mt-4 flex items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save changes"}
        </button>
        <button type="button" onClick={onClose} className="text-xs font-medium text-zinc-500 hover:underline">
          Cancel
        </button>
      </div>
    </form>
  );
}
