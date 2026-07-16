import { createClient } from "@/lib/supabase/server";
import CategoriesForm from "./categories-form";

export default async function CategoriesPage() {
  const supabase = await createClient();

  const [{ data: categories }, { data: subcategories }, { data: coa }] = await Promise.all([
    supabase.from("expense_categories").select("id, name, is_active").order("name"),
    supabase
      .from("expense_subcategories")
      .select(
        "id, name, category_id, default_coa_head_id, is_active, coa_heads(name, code)",
      )
      .order("name"),
    supabase.from("coa_heads").select("id, code, name, is_active").eq("is_active", true).order("name"),
  ]);

  return (
    <div>
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
        Categories &amp; subcategories
      </h1>
      <p className="mt-1 text-sm text-zinc-500">
        Requester picks Category → Subcategory. COA Head auto-fills from the subcategory&apos;s mapping.
      </p>

      <div className="mt-8">
        <CategoriesForm
          categories={categories ?? []}
          subcategories={(subcategories ?? []) as unknown as SubcategoryRow[]}
          coa={coa ?? []}
        />
      </div>
    </div>
  );
}

type SubcategoryRow = {
  id: string;
  name: string;
  category_id: string;
  default_coa_head_id: string;
  is_active: boolean;
  coa_heads: { name: string; code: string } | null;
};
