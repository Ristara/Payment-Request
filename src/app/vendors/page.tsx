import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUserRoles, requireUser } from "@/lib/auth";
import PageHeader from "@/components/PageHeader";
import VendorsList, { type VendorListItem } from "./vendors-list";

type VendorRow = {
  id: string;
  name: string;
  gstin: string | null;
  pan: string;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  submitter: { full_name: string } | null;
};

export default async function VendorsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requireUser();
  const { roles } = await getCurrentUserRoles();
  const canApproveVendors = roles.includes("accounts") || roles.includes("admin");

  const supabase = await createClient();
  const { status = "all" } = await searchParams;

  let query = supabase
    .from("vendors")
    .select(
      `id, name, gstin, pan, status, created_at,
       submitter:profiles!vendors_submitted_by_fkey(full_name)`,
    )
    .order("created_at", { ascending: false });

  if (status !== "all") query = query.eq("status", status);

  const [listRes, countRes] = await Promise.all([
    query,
    supabase
      .from("vendors")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
  ]);
  const vendors = ((listRes.data ?? []) as unknown as VendorRow[]).map<VendorListItem>((v) => ({
    id: v.id,
    name: v.name,
    gstin: v.gstin,
    pan: v.pan,
    status: v.status,
    submitter_name: v.submitter?.full_name ?? null,
  }));
  const pendingCount = countRes.count;

  const tabs = [
    { key: "all", label: "All" },
    { key: "pending", label: "Pending" },
    { key: "approved", label: "Approved" },
    { key: "rejected", label: "Rejected" },
  ] as const;

  return (
    <div>
      <PageHeader
        title="Vendors"
        subtitle={canApproveVendors
          ? "Verify new vendors and manage the master list."
          : "Approved vendors + your own submissions."}
        action={{ href: "/vendors/new", label: "+ New vendor" }}
      />

      <div className="mt-6 -mx-4 flex items-center gap-1 overflow-x-auto border-b border-zinc-200 px-4 sm:mx-0 sm:px-0 dark:border-zinc-800">
        {tabs.map((t) => {
          const active = (status || "all") === t.key;
          return (
            <Link
              key={t.key}
              href={`/vendors?status=${t.key}`}
              className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm ${
                active
                  ? "border-indigo-600 font-medium text-indigo-700 dark:text-indigo-300"
                  : "border-transparent text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              }`}
            >
              {t.label}
              {t.key === "pending" && (pendingCount ?? 0) > 0 && (
                <span className="ml-1 rounded-full bg-amber-100 px-1.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900 dark:text-amber-200">
                  {pendingCount}
                </span>
              )}
            </Link>
          );
        })}
      </div>

      <VendorsList vendors={vendors} />
    </div>
  );
}
