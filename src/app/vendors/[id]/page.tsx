import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUserRoles, requireUser } from "@/lib/auth";
import { VENDOR_STATUS_LABEL } from "@/lib/routing";
import { approveVendor, rejectVendor } from "@/app/vendors/actions";

type VendorRow = {
  id: string;
  name: string;
  gstin: string;
  pan: string;
  bank_account_number: string;
  bank_ifsc: string;
  bank_name: string | null;
  bank_branch: string | null;
  cancelled_cheque_path: string | null;
  status: "pending" | "approved" | "rejected";
  rejection_reason: string | null;
  created_at: string;
  submitted_by: string;
  submitter: { full_name: string; email: string } | null;
  verifier: { full_name: string } | null;
  verified_at: string | null;
};

export default async function VendorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireUser();
  const { roles } = await getCurrentUserRoles();
  const canApprove = roles.includes("accounts") || roles.includes("admin");

  const supabase = await createClient();
  const { data } = await supabase
    .from("vendors")
    .select(
      `id, name, gstin, pan, bank_account_number, bank_ifsc, bank_name, bank_branch,
       cancelled_cheque_path, status, rejection_reason, created_at, submitted_by, verified_at,
       submitter:profiles!vendors_submitted_by_fkey(full_name, email),
       verifier:profiles!vendors_verified_by_fkey(full_name)`,
    )
    .eq("id", id)
    .maybeSingle();

  if (!data) notFound();
  const v = data as unknown as VendorRow;

  // Signed URL for cheque
  let chequeUrl: string | null = null;
  if (v.cancelled_cheque_path) {
    const admin = createAdminClient();
    const { data: signed } = await admin.storage
      .from("vendor-docs")
      .createSignedUrl(v.cancelled_cheque_path, 3600);
    chequeUrl = signed?.signedUrl ?? null;
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 text-sm">
        <Link href="/vendors" className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
          ← All vendors
        </Link>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-zinc-900 sm:text-2xl dark:text-zinc-50">{v.name}</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Submitted by {v.submitter?.full_name ?? "—"} · {new Date(v.created_at).toLocaleDateString()}
          </p>
        </div>
        <VendorStatusPill status={v.status} />
      </div>

      <section className="mt-6 grid grid-cols-1 gap-4 sm:mt-8 sm:grid-cols-2 sm:gap-6">
        <Card title="Tax IDs">
          <Row label="GSTIN" value={v.gstin} mono />
          <Row label="PAN" value={v.pan} mono />
        </Card>
        <Card title="Bank">
          <Row label="Account #" value={v.bank_account_number} mono />
          <Row label="IFSC" value={v.bank_ifsc} mono />
          {v.bank_name && <Row label="Bank" value={v.bank_name} />}
          {v.bank_branch && <Row label="Branch" value={v.bank_branch} />}
        </Card>
      </section>

      {chequeUrl && (
        <section className="mt-6 rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Cancelled cheque</h2>
          <div className="mt-3">
            <a
              href={chequeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block rounded-md border border-zinc-200 p-2 hover:border-indigo-400 dark:border-zinc-800"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={chequeUrl} alt="Cancelled cheque" className="max-h-72 rounded" />
            </a>
            <p className="mt-2 text-xs text-zinc-500">Click to open at full size.</p>
          </div>
        </section>
      )}

      {v.status === "rejected" && v.rejection_reason && (
        <div className="mt-6 rounded-md border border-red-200 bg-red-50 p-4 text-sm dark:border-red-900 dark:bg-red-950/40">
          <p className="text-xs font-semibold uppercase tracking-wide text-red-700 dark:text-red-300">Reason</p>
          <p className="mt-1 text-red-900 dark:text-red-100">{v.rejection_reason}</p>
        </div>
      )}

      {v.status === "approved" && v.verifier && (
        <p className="mt-6 text-sm text-emerald-700 dark:text-emerald-300">
          Approved by {v.verifier.full_name} · {v.verified_at ? new Date(v.verified_at).toLocaleString() : ""}
        </p>
      )}

      {canApprove && v.status === "pending" && (
        <section className="mt-8 rounded-2xl border border-indigo-200 bg-indigo-50 p-6 dark:border-indigo-900 dark:bg-indigo-950/40">
          <h2 className="text-sm font-semibold text-indigo-900 dark:text-indigo-200">
            Verify this vendor
          </h2>
          <p className="mt-1 text-sm text-indigo-900 dark:text-indigo-200">
            Check GSTIN + bank details + cheque match. Then approve or reject.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <form action={approveVendor}>
              <input type="hidden" name="id" value={v.id} />
              <button className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700">
                Approve
              </button>
            </form>
            <form action={rejectVendor} className="flex flex-1 gap-2">
              <input type="hidden" name="id" value={v.id} />
              <input
                name="reason"
                required
                placeholder="Reason for rejection"
                className="flex-1 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              />
              <button className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700">
                Reject
              </button>
            </form>
          </div>
        </section>
      )}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{title}</h2>
      <dl className="mt-3 space-y-2 text-sm">{children}</dl>
    </div>
  );
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-zinc-500">{label}</dt>
      <dd className={`text-zinc-900 dark:text-zinc-100 ${mono ? "font-mono text-xs" : ""}`}>{value}</dd>
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
    <span className={`rounded-full px-3 py-1 text-xs font-medium ${color}`}>
      {VENDOR_STATUS_LABEL[status] ?? status}
    </span>
  );
}
