import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { getActiveOutlets, getActiveCoaAccounts } from "@/lib/masters";
import RequestForm from "./request-form";

export default async function NewRequestPage() {
  await requireUser();
  const supabase = await createClient();

  const [vendorsRes, outlets, coaAccounts] = await Promise.all([
    supabase
      .from("vendors")
      .select("id, name, gstin, status")
      .in("status", ["approved", "pending"])
      .order("name"),
    getActiveOutlets(),
    getActiveCoaAccounts(),
  ]);
  const vendors = { data: vendorsRes.data };

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
          vendors={(vendors.data ?? []) as { id: string; name: string; gstin: string | null; status: string }[]}
          outlets={outlets as { id: string; code: string; name: string }[]}
          coaAccounts={coaAccounts as { id: string; code: number; subcategory: string; category: string; coa: string }[]}
        />
      </div>
    </div>
  );
}
