import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUserRoles, requireUser } from "@/lib/auth";
import { VENDOR_STATUS_LABEL } from "@/lib/routing";
import PageHeader from "@/components/PageHeader";

type Vendor = {
  id: string;
  name: string;
  gstin: string;
  pan: string;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  submitted_by: string;
  submitter: { full_name: string } | null;
};

export default async function VendorsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  await requireUser();
  const { roles } = await getCurrentUserRoles();
  const canApproveVendors = roles.includes("accounts") || roles.includes("admin");

  const supabase = await createClient();
  const { status = "all", q = "" } = await searchParams;

  let query = supabase
    .from("vendors")
    .select(
      `id, name, gstin, pan, status, created_at, submitted_by,
       submitter:profiles!vendors_submitted_by_fkey(full_name)`,
    )
    .order("created_at", { ascending: false });

  if (status !== "all") query = query.eq("status", status);
  if (q) query = query.ilike("name", `%${q}%`);

  const { data } = await query;
  const vendors = (data ?? []) as unknown as Vendor[];

  const { count: pendingCount } = await supabase
    .from("vendors")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");

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
              href={`/vendors?status=${t.key}${q ? `&q=${q}` : ""}`}
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

      {vendors.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
          No vendors {status !== "all" ? `in ${status}` : "yet"}. Click{" "}
          <Link href="/vendors/new" className="text-indigo-600 underline">New vendor</Link> to add one.
        </div>
      ) : (
        <>
          {/* Mobile: card list */}
          <ul className="mt-6 space-y-3 sm:hidden">
            {vendors.map((v) => (
              <li key={v.id}>
                <Link
                  href={`/vendors/${v.id}`}
                  className="block rounded-xl border border-zinc-200 bg-white p-4 active:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-base font-medium text-zinc-900 dark:text-zinc-100">{v.name}</p>
                      <p className="mt-0.5 truncate font-mono text-xs text-zinc-500">GSTIN {v.gstin}</p>
                    </div>
                    <VendorStatusPill status={v.status} />
                  </div>
                  <p className="mt-2 text-xs text-zinc-500">
                    Submitted by {v.submitter?.full_name ?? "—"}
                  </p>
                </Link>
              </li>
            ))}
          </ul>

          {/* Desktop: table */}
          <section className="mt-6 hidden rounded-2xl border border-zinc-200 bg-white sm:block dark:border-zinc-800 dark:bg-zinc-900">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
                  <tr>
                    <th className="px-5 py-3">Name</th>
                    <th className="px-5 py-3">GSTIN</th>
                    <th className="px-5 py-3">PAN</th>
                    <th className="px-5 py-3">Submitted by</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {vendors.map((v) => (
                    <tr key={v.id} className="border-b border-zinc-100 last:border-b-0 dark:border-zinc-800">
                      <td className="px-5 py-3 font-medium text-zinc-900 dark:text-zinc-100">{v.name}</td>
                      <td className="px-5 py-3 font-mono text-xs text-zinc-600 dark:text-zinc-400">{v.gstin}</td>
                      <td className="px-5 py-3 font-mono text-xs text-zinc-600 dark:text-zinc-400">{v.pan}</td>
                      <td className="px-5 py-3 text-zinc-600 dark:text-zinc-400">{v.submitter?.full_name ?? "—"}</td>
                      <td className="px-5 py-3"><VendorStatusPill status={v.status} /></td>
                      <td className="px-5 py-3 text-right">
                        <Link href={`/vendors/${v.id}`} className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400">Open →</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function VendorStatusPill({ status }: { status: string }) {
  const color =
    status === "approved"
      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200"
      : status === "rejected"
        ? "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-200"
        : "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-200";
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${color}`}>
      {VENDOR_STATUS_LABEL[status] ?? status}
    </span>
  );
}
