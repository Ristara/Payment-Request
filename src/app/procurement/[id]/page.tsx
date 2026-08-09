import Link from "next/link";
import { notFound } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUserRoles, requireUser } from "@/lib/auth";
import { formatINR, formatISTDate, formatISTDateTime } from "@/lib/types";
import ProcurementActions from "./procurement-actions";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  pending_approval: "Pending approval",
  approved: "Approved — needs a PO",
  po_obtained: "PO obtained",
  closed: "Closed",
  rejected: "Rejected",
  cancelled: "Withdrawn",
};

export default async function ProcurementDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { roles } = await getCurrentUserRoles();
  const { id } = await params;
  const supabase = await createClient();

  // Read through the user's client, so RLS decides whether this page exists
  // for them at all. A 404 rather than a "not allowed" — telling someone a
  // request exists but is none of their business is itself a disclosure.
  const { data } = await supabase
    .from("procurement_requests")
    .select(
      `id, request_number, title, description, status, expense_type, coa, coa_category,
       created_at, approved_at, rejection_reason,
       po_reference, po_obtained_at, submitter_id,
       outlet:outlets(name),
       submitter:profiles!procurement_requests_submitter_id_fkey(full_name),
       approver:profiles!procurement_requests_approver_id_fkey(full_name),
       procurer:profiles!procurement_requests_procured_by_fkey(full_name),
       po_vendor:vendors!procurement_requests_po_vendor_id_fkey(name),
       account:coa_accounts(subcategory)`,
    )
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();

  const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
  const r = data as Record<string, unknown>;
  const outletName = one(r.outlet as { name: string } | null)?.name ?? "—";
  const submitterName = one(r.submitter as { full_name: string } | null)?.full_name ?? "—";
  const approverName = one(r.approver as { full_name: string } | null)?.full_name ?? null;
  const procurerName = one(r.procurer as { full_name: string } | null)?.full_name ?? null;
  const poVendorName = one(r.po_vendor as { name: string } | null)?.name ?? null;
  const status = r.status as string;

  const isSubmitter = r.submitter_id === user.id;
  const canApprove = roles.includes("approver") || roles.includes("admin");
  // Whoever raised it sources it and records the PO — there is no separate
  // procurement team. Re-checked server-side in recordPurchaseOrder.
  const canProcure = isSubmitter || roles.includes("admin");

  const { data: vendorRows } = await supabase
    .from("vendors")
    .select("id, name")
    .eq("status", "approved")
    .order("name");

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/procurement" className="text-sm text-indigo-600 hover:underline dark:text-indigo-400">
        ← All procurement requests
      </Link>

      <PageHeader
        title={r.title as string}
        subtitle={`${r.request_number as string} · ${outletName} · raised by ${submitterName} on ${formatISTDate(r.created_at as string)}`}
      />

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
          {STATUS_LABEL[status] ?? status}
        </span>
        <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          {r.expense_type === "opex" ? "OpEx" : "CapEx"}
        </span>

      </div>

      {(r.coa as string | null) && (
        <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
          {/* The full path, so the classification is readable without knowing
              which column maps to which label. */}
          {[
            r.coa as string,
            r.expense_type === "opex" ? null : (r.coa_category as string | null),
            one(r.account as { subcategory: string } | null)?.subcategory ?? null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}

      <section className="mt-6 rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Details</h2>
        <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-800 dark:text-zinc-200">
          {r.description as string}
        </p>
      </section>

      {status === "rejected" && (r.rejection_reason as string | null) && (
        <div className="mt-6 rounded-md border border-red-200 bg-red-50 p-4 text-sm dark:border-red-900 dark:bg-red-950/40">
          <p className="text-xs font-semibold uppercase tracking-wide text-red-700 dark:text-red-300">
            Rejected{approverName ? ` by ${approverName}` : ""}
          </p>
          <p className="mt-1 text-red-900 dark:text-red-100">{r.rejection_reason as string}</p>
        </div>
      )}

      {(r.po_reference as string | null) && (
        <section className="mt-6 rounded-2xl border border-indigo-200 bg-indigo-50 p-6 dark:border-indigo-900 dark:bg-indigo-950/30">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-indigo-700 dark:text-indigo-300">
            Purchase order
          </h2>
          <p className="mt-1 font-mono text-sm font-medium text-zinc-900 dark:text-zinc-100">
            {r.po_reference as string}
          </p>
          <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
            {poVendorName ? `${poVendorName} · ` : ""}
            {procurerName ? `recorded by ${procurerName}` : ""}
            {r.po_obtained_at ? ` · ${formatISTDateTime(r.po_obtained_at as string)}` : ""}
          </p>
          {/* Phase 2 wires this into a pre-filled payment request. Saying so
              beats a button that quietly does half the job. */}
          <p className="mt-3 text-xs text-zinc-600 dark:text-zinc-400">
            Raise the payment against this PO from{" "}
            <Link href="/requests/new" className="font-medium text-indigo-700 underline dark:text-indigo-300">
              Raise payment request
            </Link>
            .
          </p>
        </section>
      )}

      {approverName && status !== "rejected" && (
        <p className="mt-6 text-sm text-emerald-700 dark:text-emerald-300">
          Approved by {approverName}
          {r.approved_at ? ` · ${formatISTDateTime(r.approved_at as string)}` : ""}
        </p>
      )}

      <ProcurementActions
        id={id}
        status={status}
        isSubmitter={isSubmitter}
        canApprove={canApprove}
        canProcure={canProcure}
        vendors={(vendorRows ?? []) as { id: string; name: string }[]}
      />
    </div>
  );
}
