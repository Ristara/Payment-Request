import Link from "next/link";
import { getCoaAccounts } from "@/lib/masters";
import { COA_LABEL } from "@/lib/coa-labels";
import { EXPENSE_LABEL, type ExpenseType } from "@/lib/access-labels";
import CoaForm from "./coa-form";

/**
 * One page per chart. CapEx and OpEx are different shapes — three levels
 * against two — so showing them in one list would mean a column that is
 * blank for half the rows and a rename that means different things
 * depending on which half you are looking at.
 */
export default async function CoaPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const { type } = await searchParams;
  const expenseType: ExpenseType = type === "opex" ? "opex" : "capex";
  const all = await getCoaAccounts();
  const rows = (all as { expense_type: ExpenseType }[]).filter(
    (r) => r.expense_type === expenseType,
  );
  const isOpex = expenseType === "opex";

  return (
    <div>
      <h1 className="text-xl font-semibold text-zinc-900 sm:text-2xl dark:text-zinc-50">
        Chart of Accounts
      </h1>

      <div className="mt-4 flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
        {(["capex", "opex"] as const).map((t) => {
          const active = expenseType === t;
          return (
            <Link
              key={t}
              href={`/admin/coa?type=${t}`}
              className={`border-b-2 px-3 py-2 text-sm ${
                active
                  ? "border-indigo-600 font-medium text-indigo-700 dark:text-indigo-300"
                  : "border-transparent text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              }`}
            >
              {EXPENSE_LABEL[t]}
            </Link>
          );
        })}
      </div>

      <p className="mt-3 text-sm text-zinc-500">
        {isOpex ? (
          <>
            {EXPENSE_LABEL.opex} runs two levels: {COA_LABEL.level1.toLowerCase()} and{" "}
            {COA_LABEL.level3.toLowerCase()}. Renaming a {COA_LABEL.level1.toLowerCase()} updates
            every {COA_LABEL.level3.toLowerCase()} under it.
          </>
        ) : (
          <>
            {EXPENSE_LABEL.capex} runs three levels: {COA_LABEL.level1.toLowerCase()},{" "}
            {COA_LABEL.level2.toLowerCase()} and {COA_LABEL.level3.toLowerCase()}. Renaming a{" "}
            {COA_LABEL.level1.toLowerCase()} or {COA_LABEL.level2.toLowerCase()} updates everything
            under it.
          </>
        )}{" "}
        Codes are auto-generated per {COA_LABEL.level3.toLowerCase()} and can&apos;t be edited.
      </p>

      <div className="mt-6">
        <CoaForm rows={rows as never} expenseType={expenseType} />
      </div>
    </div>
  );
}
