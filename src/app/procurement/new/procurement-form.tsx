"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { createProcurementRequest } from "@/app/procurement/actions";

export type OutletOption = { id: string; name: string };

const FIELD =
  "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-950";

export default function ProcurementForm({
  outlets,
  reservedNumber,
}: {
  outlets: OutletOption[];
  reservedNumber: string | null;
}) {
  const [state, action, pending] = useActionState(createProcurementRequest, undefined);
  const router = useRouter();

  // Straight to the list on success. Leaving the filled form on screen invites
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
        <label htmlFor="title" className="mb-1 block text-sm font-medium">
          What do you need? <span className="text-red-600">*</span>
        </label>
        <input id="title" name="title" required maxLength={140} className={FIELD}
          placeholder="e.g. Deep freezer repair, 20 dining chairs" />
      </div>

      <div>
        <label htmlFor="description" className="mb-1 block text-sm font-medium">
          Details <span className="text-red-600">*</span>
        </label>
        <textarea id="description" name="description" required rows={4} maxLength={2000} className={FIELD}
          placeholder="What is wrong, or what exactly is needed. Procurement will source against this." />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="outlet_id" className="mb-1 block text-sm font-medium">
            Branch <span className="text-red-600">*</span>
          </label>
          <select id="outlet_id" name="outlet_id" required defaultValue="" className={FIELD}>
            <option value="" disabled>Choose a branch…</option>
            {outlets.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="expense_type" className="mb-1 block text-sm font-medium">
            Expense type <span className="text-red-600">*</span>
          </label>
          <select id="expense_type" name="expense_type" defaultValue="capex" className={FIELD}>
            <option value="capex">CapEx — assets &amp; construction</option>
            <option value="opex">OpEx — rent &amp; utilities</option>
          </select>
        </div>

        <div>
          <label htmlFor="estimated_amount" className="mb-1 block text-sm font-medium">
            Rough cost (₹)
          </label>
          <input id="estimated_amount" name="estimated_amount" inputMode="decimal" className={FIELD}
            placeholder="Optional" />
          {/* Said plainly, because people hesitate over a number they might be
              held to. It exists so an approver can size the decision. */}
          <p className="mt-1 text-xs text-zinc-500">
            A guess is fine — it just helps whoever approves it judge the size.
          </p>
        </div>

        <div>
          <label htmlFor="priority" className="mb-1 block text-sm font-medium">Priority</label>
          <select id="priority" name="priority" defaultValue="normal" className={FIELD}>
            <option value="normal">Normal</option>
            <option value="urgent">Urgent</option>
          </select>
        </div>
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
