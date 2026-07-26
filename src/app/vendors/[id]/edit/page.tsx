import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUserRoles, requireUser } from "@/lib/auth";
import VendorEditForm, { type EditableVendor } from "./edit-form";

export default async function EditVendorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireUser();
  const { user, roles } = await getCurrentUserRoles();
  const supabase = await createClient();

  const { data } = await supabase
    .from("vendors")
    .select(
      `id, name, gstin, pan, phone, email, bank_account_number, bank_ifsc,
       bank_name, bank_branch, status, submitted_by`,
    )
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();

  const v = data as unknown as EditableVendor & { status: string; submitted_by: string };
  const isStaff = roles.includes("accounts") || roles.includes("admin");
  const ownerMayEdit = v.submitted_by === user!.id && v.status !== "approved";
  // Same rule the server action enforces — fail early with a clear page
  // instead of letting the user fill a form they can't submit.
  if (!isStaff && !ownerMayEdit) redirect(`/vendors/${id}`);

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4 text-sm">
        <Link href={`/vendors/${id}`} className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
          ← Back to vendor
        </Link>
      </div>
      <h1 className="text-xl font-semibold text-zinc-900 sm:text-2xl dark:text-zinc-50">
        Edit vendor
      </h1>
      <p className="mt-1 text-sm text-zinc-500">{v.name}</p>
      <div className="mt-6">
        <VendorEditForm vendor={v} />
      </div>
    </div>
  );
}
