import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser, getCurrentUserRoles } from "@/lib/auth";
import { getRaiseAccess, hasUnrestrictedRaise, moduleDenied } from "@/lib/access";
import { getActiveOutlets, getActiveCoaAccounts } from "@/lib/masters";
import RequestForm from "./request-form";
import { shortRequestNumber } from "@/lib/types";

// Fresh each visit — otherwise the reserved request number below would
// be cached and every user would see the same one.
export const dynamic = "force-dynamic";

export default async function NewRequestPage() {
  const user = await requireUser();
  // The form itself is harmless, but rendering it for someone whose submit
  // will be refused is just a slower way of saying no.
  const { roles } = await getCurrentUserRoles();
  if (!roles.includes("requester") && !roles.includes("admin")) {
    redirect("/dashboard?denied=raise");
  }
  // Only offer what they may actually raise for — a branch they can't use
  // has no business being in the dropdown.
  const access = await getRaiseAccess(user.id, hasUnrestrictedRaise(roles));
  // Not given this raise path at all — the nav hides it, but the URL is still
  // typeable and the old link still bookmarked.
  if (moduleDenied(access, "payment")) {
    redirect("/dashboard?denied=module");
  }
  // Nothing to raise for means nothing to show — an empty form that can only
  // be rejected wastes the trip.
  if (!access.unrestricted && (access.outletIds.length === 0 || access.expenseTypes.length === 0)) {
    redirect("/dashboard?denied=noaccess");
  }
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
              {shortRequestNumber(reservedNumber)}
            </p>
          </div>
        )}
      </div>

      <div className="mt-8">
        <RequestForm
          vendors={(vendors.data ?? []) as { id: string; name: string; gstin: string | null; status: string }[]}
          outlets={
            (access.unrestricted
              ? outlets
              : (outlets as { id: string }[]).filter((o) => access.outletIds.includes(o.id))) as {
              id: string;
              code: string;
              name: string;
              stage: "upcoming" | "operational";
            }[]
          }
          expenseTypes={access.expenseTypes}
          coaAccounts={
            coaAccounts as {
              id: string;
              code: number;
              subcategory: string;
              category: string;
              coa: string;
              expense_type: "capex" | "opex";
            }[]
          }
          reservedNumber={reservedNumber}
          people={people}
        />
      </div>
    </div>
  );
}
