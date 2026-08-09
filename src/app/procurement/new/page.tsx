import { redirect } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import { getCurrentUserRoles, requireUser } from "@/lib/auth";
import { getActiveOutlets } from "@/lib/masters";
import { getRaiseAccess, hasUnrestrictedRaise } from "@/lib/access";
import { createAdminClient } from "@/lib/supabase/admin";
import ProcurementForm from "./procurement-form";

export const dynamic = "force-dynamic";

export default async function NewProcurementPage() {
  const user = await requireUser();
  const { roles } = await getCurrentUserRoles();
  if (!roles.includes("requester") && !roles.includes("admin")) {
    redirect("/dashboard?denied=raise");
  }

  // The same branch rule as a payment request — offering a branch the database
  // will then refuse is worse than not offering it.
  const [allOutlets, access] = await Promise.all([
    getActiveOutlets(),
    getRaiseAccess(user.id, hasUnrestrictedRaise(roles)),
  ]);
  const allowed = new Set(access.outletIds);
  const outlets = (allOutlets as { id: string; name: string; stage: string }[]).filter(
    (o) => access.unrestricted || allowed.has(o.id),
  );

  const admin = createAdminClient();
  const { data: seq } = await admin.rpc("next_procurement_number");
  const reservedNumber = typeof seq === "string" ? seq : null;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Raise a procurement request"
        subtitle="For something that needs buying or fixing. No vendor or price needed yet — that comes once it's approved and you get a PO."
      />
      {outlets.length === 0 ? (
        <p className="mt-6 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          You haven&rsquo;t been given any branches to raise for. Ask an admin to assign yours.
        </p>
      ) : (
        <ProcurementForm outlets={outlets} reservedNumber={reservedNumber} />
      )}
    </div>
  );
}
