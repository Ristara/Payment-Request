import { getCoaAccounts } from "@/lib/masters";
import { COA_LABEL } from "@/lib/coa-labels";
import CoaForm from "./coa-form";

export default async function CoaPage() {
  const rows = await getCoaAccounts();
  return (
    <div>
      <h1 className="text-xl font-semibold text-zinc-900 sm:text-2xl dark:text-zinc-50">
        Chart of Accounts
      </h1>
      <p className="mt-1 text-sm text-zinc-500">
        Manage {COA_LABEL.level1.toLowerCase()}s, {COA_LABEL.level2.toLowerCase()}s and
        {" "}{COA_LABEL.level3.toLowerCase()}s. Renaming a {COA_LABEL.level1.toLowerCase()} or
        {" "}{COA_LABEL.level2.toLowerCase()} updates everything under it. Codes are
        auto-generated per {COA_LABEL.level3.toLowerCase()} and can&apos;t be edited.
      </p>

      <div className="mt-6">
        <CoaForm rows={rows} />
      </div>
    </div>
  );
}
