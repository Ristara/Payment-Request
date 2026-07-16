import { getCoaAccounts } from "@/lib/masters";
import CoaForm from "./coa-form";

export default async function CoaPage() {
  const rows = await getCoaAccounts();
  return (
    <div>
      <h1 className="text-xl font-semibold text-zinc-900 sm:text-2xl dark:text-zinc-50">
        Chart of Accounts
      </h1>
      <p className="mt-1 text-sm text-zinc-500">
        One row per selectable account. Requesters pick a <em>subcategory</em>; the
        category and COA auto-fill. Codes are auto-generated in sequence and
        can&apos;t be edited.
      </p>

      <div className="mt-6">
        <CoaForm rows={rows} />
      </div>
    </div>
  );
}
