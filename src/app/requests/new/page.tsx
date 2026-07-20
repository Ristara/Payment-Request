import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth";
import { getActiveOutlets, getActiveCoaAccounts } from "@/lib/masters";
import RequestForm from "./request-form";

// Fresh each visit — otherwise the reserved request number below would
// be cached and every user would see the same one.
export const dynamic = "force-dynamic";

export default async function NewRequestPage() {
  const user = await requireUser();
  const supabase = await createClient();
  const admin = createAdminClient();

  const [vendorsRes, outlets, coaAccounts, seqRes, peopleRes] = await Promise.all([
    supabase
      .from("vendors")
      .select("id, name, gstin, status")
      .in("status", ["approved", "pending"])
      .order("name"),
    getActiveOutlets(),
    getActiveCoaAccounts(),
    admin.rpc("next_request_number"),
    supabase
      .from("profiles")
      .select("id, full_name, email")
      .eq("is_active", true)
      .order("full_name"),
  ]);
  const vendors = { data: vendorsRes.data };
  const reservedNumber = typeof seqRes.data === "string" ? seqRes.data : null;
  const people = ((peopleRes.data ?? []) as { id: string; full_name: string; email: string }[])
    .filter((p) => p.id !== user.id);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 text-sm">
        <Link href="/requests" className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
          ← All my requests
        </Link>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Raise a payment request</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Fill in vendor + amount + purpose. COA auto-fills from your subcategory choice.
          </p>
        </div>
        {reservedNumber && (
          <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-right dark:border-indigo-900 dark:bg-indigo-950/40">
            <p className="text-[10px] font-medium uppercase tracking-wide text-indigo-700 dark:text-indigo-300">
              Request ID
            </p>
            <p className="font-mono text-sm font-semibold text-indigo-900 dark:text-indigo-100">
              {reservedNumber}
            </p>
          </div>
        )}
      </div>

      <div className="mt-8">
        <RequestForm
          vendors={(vendors.data ?? []) as { id: string; name: string; gstin: string | null; status: string }[]}
          outlets={outlets as { id: string; code: string; name: string }[]}
          coaAccounts={coaAccounts as { id: string; code: number; subcategory: string; category: string; coa: string }[]}
          reservedNumber={reservedNumber}
          people={people}
        />
      </div>
    </div>
  );
}
