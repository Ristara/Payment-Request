import { createClient } from "@/lib/supabase/server";
import CoaForm from "./coa-form";

export default async function CoaPage() {
  const supabase = await createClient();
  const { data: coa } = await supabase
    .from("coa_heads")
    .select("id, code, name, is_active")
    .order("name");

  return (
    <div>
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">COA Heads</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Ledger accounts your P&amp;L rolls up to. Every subcategory maps to one COA head as its default.
      </p>

      <div className="mt-8">
        <CoaForm coa={coa ?? []} />
      </div>
    </div>
  );
}
