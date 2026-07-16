import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import RequestForm from "./request-form";

export default async function NewRequestPage() {
  await requireUser();
  const supabase = await createClient();

  const [vendors, outlets, categories, subcategories, coa] = await Promise.all([
    supabase
      .from("vendors")
      .select("id, name, gstin, status")
      .in("status", ["approved", "pending"])
      .order("name"),
    supabase.from("outlets").select("id, code, name").eq("is_active", true).order("name"),
    supabase.from("expense_categories").select("id, name").eq("is_active", true).order("name"),
    supabase
      .from("expense_subcategories")
      .select("id, name, category_id, default_coa_head_id")
      .eq("is_active", true)
      .order("name"),
    supabase.from("coa_heads").select("id, code, name").eq("is_active", true).order("name"),
  ]);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 text-sm">
        <Link href="/requests" className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
          ← All my requests
        </Link>
      </div>
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Raise a payment request</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Fill in vendor + amount + purpose. COA auto-fills from your subcategory choice.
      </p>

      <div className="mt-8">
        <RequestForm
          vendors={(vendors.data ?? []) as { id: string; name: string; gstin: string; status: string }[]}
          outlets={(outlets.data ?? []) as { id: string; code: string; name: string }[]}
          categories={(categories.data ?? []) as { id: string; name: string }[]}
          subcategories={
            (subcategories.data ?? []) as {
              id: string;
              name: string;
              category_id: string;
              default_coa_head_id: string;
            }[]
          }
          coa={(coa.data ?? []) as { id: string; code: string; name: string }[]}
        />
      </div>
    </div>
  );
}
