"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createProcurementRequest } from "@/app/procurement/actions";
import CoaCascade, { type CoaAccount, type CoaSelection } from "@/components/CoaCascade";
import Combobox from "@/components/Combobox";
import PersistentFileInput from "@/components/PersistentFileInput";
import { COA_LABEL, COA_PATH } from "@/lib/coa-labels";

export type OutletOption = { id: string; name: string; stage: string };
export type PersonOption = { id: string; full_name: string };

const FIELD =
  "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-950";

/**
 * Raising a procurement request.
 *
 * It asks what the payment form asks, MINUS everything commercial — no vendor,
 * no quote, no quantity, rate, amount, instalment or date. At this point none
 * of that exists: not knowing the vendor or the price is the whole reason the
 * request is being raised.
 */
export default function ProcurementForm({
  outlets,
  coaAccounts,
  people,
  reservedNumber,
}: {
  outlets: OutletOption[];
  coaAccounts: CoaAccount[];
  people: PersonOption[];
  reservedNumber: string | null;
}) {
  const [state, action, pending] = useActionState(createProcurementRequest, undefined);
  const router = useRouter();
  const [expense, setExpense] = useState<"capex" | "opex">("capex");
  const [storeType, setStoreType] = useState<"upcoming" | "operational" | "">("");
  const [coa, setCoa] = useState<CoaSelection>({ coa: "", category: "", accountId: "" });
  const [cc, setCc] = useState<PersonOption[]>([]);

  // OpEx is always an existing outlet — the payment form does not even ask, so
  // neither does this. Rent and utilities do not belong to a store that has
  // not opened.
  const effectiveStage = expense === "opex" ? "operational" : storeType;
  const visibleOutlets = useMemo(
    () => (effectiveStage ? outlets.filter((o) => o.stage === effectiveStage) : []),
    [outlets, effectiveStage],
  );

  // Straight to the list on success — leaving a filled form on screen invites
  // a second click and a duplicate request.
  useEffect(() => {
    if (state?.info) router.push("/procurement");
  }, [state?.info, router]);

  return (
    <form action={action} className="mt-6 space-y-5">
      {reservedNumber && (
        <p className="text-xs text-zinc-500">
          This will be <span className="font-mono font-medium">{reservedNumber}</span>
        </p>
      )}

      <div>
        <span className="mb-1 block text-sm font-medium">
          Expense type <span className="text-red-600">*</span>
        </span>
        <div className="grid grid-cols-2 gap-3">
          {(["capex", "opex"] as const).map((k) => (
            <button
              type="button"
              key={k}
              onClick={() => {
                setExpense(k);
                if (k === "opex") setStoreType("");
                // CapEx and OpEx have different charts, so a selection made
                // under one is meaningless under the other.
                setCoa({ coa: "", category: "", accountId: "" });
              }}
              className={
                expense === k
                  ? "rounded-xl border-2 border-indigo-600 bg-indigo-50 px-4 py-3 text-left dark:bg-indigo-950/40"
                  : "rounded-xl border border-zinc-200 px-4 py-3 text-left hover:border-zinc-300 dark:border-zinc-800"
              }
            >
              <span className="block text-sm font-semibold">{k === "capex" ? "CapEx" : "OpEx"}</span>
              <span className="block text-xs text-zinc-500">
                {k === "capex" ? "Assets & construction" : "Rent & utilities"}
              </span>
            </button>
          ))}
        </div>
        <input type="hidden" name="expense_type" value={expense} />
      </div>

      {expense === "capex" && (
        <div>
          <span className="mb-1 block text-sm font-medium">
            What is this for? <span className="text-red-600">*</span>
          </span>
          <div className="grid grid-cols-2 gap-3">
            {([
              { k: "upcoming", title: "New Store", hint: "Upcoming outlet" },
              { k: "operational", title: "Existing Outlet", hint: "Operational outlet" },
            ] as const).map((o) => (
              <button
                type="button"
                key={o.k}
                onClick={() => setStoreType(o.k)}
                className={
                  storeType === o.k
                    ? "rounded-xl border-2 border-indigo-600 bg-indigo-50 px-4 py-3 text-left dark:bg-indigo-950/40"
                    : "rounded-xl border border-zinc-200 px-4 py-3 text-left hover:border-zinc-300 dark:border-zinc-800"
                }
              >
                <span className="block text-sm font-semibold">{o.title}</span>
                <span className="block text-xs text-zinc-500">{o.hint}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <label htmlFor="title" className="mb-1 block text-sm font-medium">
          Title <span className="text-red-600">*</span>
        </label>
        <input id="title" name="title" required maxLength={140} className={FIELD}
          placeholder="e.g. Deep freezer repair — HSR" />
      </div>

      <div>
        <label htmlFor="outlet_id" className="mb-1 block text-sm font-medium">
          Outlet <span className="text-red-600">*</span>
        </label>
        <select id="outlet_id" name="outlet_id" required defaultValue="" className={FIELD}>
          <option value="" disabled>
            {effectiveStage ? "Choose an outlet…" : "Choose New Store / Existing Outlet first…"}
          </option>
          {visibleOutlets.map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </select>
        {effectiveStage && visibleOutlets.length === 0 && (
          <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
            None of your outlets are {effectiveStage === "upcoming" ? "upcoming" : "operational"}.
          </p>
        )}
      </div>

      <div>
        <span className="mb-1 block text-sm font-medium">
          {expense === "opex" ? `${COA_LABEL.level1} · ${COA_LABEL.level3}` : COA_PATH}{" "}
          <span className="text-red-600">*</span>
        </span>
        <CoaCascade
          accounts={coaAccounts.filter((a) => a.expense_type === expense)}
          value={coa}
          onChange={setCoa}
          isOpex={expense === "opex"}
          required
        />
      </div>

      <div>
        <label htmlFor="description" className="mb-1 block text-sm font-medium">
          Purpose / description <span className="text-red-600">*</span>
        </label>
        <textarea id="description" name="description" required rows={4} maxLength={2000} className={FIELD}
          placeholder="What is wrong, or what exactly is needed." />
      </div>

      {/* ---- Supporting documents ---------------------------------------- */}
      <div>
        <span className="mb-1 block text-sm font-medium">Supporting documents</span>
        <p className="mb-2 text-xs text-zinc-500">
          A photo of what&rsquo;s broken, a quote, anything that helps whoever approves it.
        </p>
        <PersistentFileInput name="attachments" multiple accept="image/*,application/pdf" />
      </div>

      {/* ---- CC ----------------------------------------------------------- */}
      <div>
        <span className="mb-1 block text-sm font-medium">CC (optional)</span>
        <p className="mb-2 text-xs text-zinc-500">
          They&rsquo;ll be notified and can open the request.
        </p>
        <Combobox
          options={people
            .filter((p) => !cc.some((c) => c.id === p.id))
            .map((p) => ({ value: p.id, label: p.full_name }))}
          value=""
          onChange={(id) => {
            const person = people.find((p) => p.id === id);
            if (person) setCc((prev) => [...prev, person]);
          }}
          placeholder="Search a person to CC…"
          ariaLabel="CC person"
        />
        {cc.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-2">
            {cc.map((p) => (
              <li key={p.id} className="inline-flex items-center gap-1 rounded-full bg-zinc-100 py-1 pl-3 pr-1 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                {p.full_name}
                <button
                  type="button"
                  onClick={() => setCc((prev) => prev.filter((x) => x.id !== p.id))}
                  aria-label={`Remove ${p.full_name} from CC`}
                  className="flex h-4 w-4 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-300 hover:text-zinc-900 dark:hover:bg-zinc-600 dark:hover:text-white"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        <input type="hidden" name="cc_user_ids" value={JSON.stringify(cc.map((p) => p.id))} />
      </div>

      {state?.error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {state.error}
        </p>
      )}

      <button
        disabled={pending}
        className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
      >
        {pending ? "Raising…" : "Raise procurement request"}
      </button>
    </form>
  );
}
