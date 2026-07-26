import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUserRoles, requireUser } from "@/lib/auth";
import { VENDOR_STATUS_LABEL } from "@/lib/routing";
import ApprovalPanel from "./approval-panel";
import { formatISTDate, formatISTDateTime, formatINR, shortRequestNumber } from "@/lib/types";

type VendorRow = {
  id: string;
  name: string;
  gstin: string | null;
  pan: string;
  phone: string | null;
  email: string | null;
  bank_account_number: string | null;
  bank_ifsc: string | null;
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

// Bound the fetch: a long-running vendor could otherwise pull every thread.
const THREAD_LIMIT = 100;

type ThreadRow = {
  id: string;
  request_number: string;
  title: string | null;
  created_at: string;
  line_items: { amount: number }[];
  installments: {
    installment_number: number;
    status: string;
    requested_amount: number;
    payment_record: { paid_amount: number | null }[] | { paid_amount: number | null } | null;
  }[];
};

export default async function VendorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireUser();
  const { user, roles } = await getCurrentUserRoles();
  const canApprove = roles.includes("accounts") || roles.includes("admin");

  const supabase = await createClient();
  const [vendorRes, threadRes] = await Promise.all([
    supabase
      .from("vendors")
      .select(
        `id, name, gstin, pan, phone, email, bank_account_number, bank_ifsc, bank_name, bank_branch,
         cancelled_cheque_path, status, rejection_reason, created_at, submitted_by, verified_at,
         submitter:profiles!vendors_submitted_by_fkey(full_name, email),
         verifier:profiles!vendors_verified_by_fkey(full_name)`,
      )
      .eq("id", id)
      .maybeSingle(),
    // Every thread raised against this vendor, with the numbers needed for
    // the money summary. RLS scopes this: a submitter sees only their own.
    supabase
      .from("payment_requests")
      .select(
        `id, request_number, title, created_at,
         line_items:request_line_items(amount),
         installments:request_installments(installment_number, status, requested_amount,
           payment_record:payment_records(paid_amount))`,
      )
      .eq("vendor_id", id)
      .order("created_at", { ascending: false })
      .limit(THREAD_LIMIT + 1),
  ]);

  if (!vendorRes.data) notFound();
  const v = vendorRes.data as unknown as VendorRow;

  const isStaff = roles.includes("accounts") || roles.includes("admin");
  const canEdit = isStaff || (v.submitted_by === user!.id && v.status !== "approved");

  const allThreads = (threadRes.data ?? []) as unknown as ThreadRow[];
  const truncated = allThreads.length > THREAD_LIMIT;
  const threads = allThreads.slice(0, THREAD_LIMIT);

  // A thread with no live installment (all cancelled / rejected) is a dead
  // commitment — it still gets listed, marked, but must not inflate what the
  // company owes this vendor.
  const DEAD = new Set(["cancelled", "rejected"]);
  const txns = threads.map((t) => {
    const poValue = t.line_items.reduce((s, l) => s + Number(l.amount), 0);
    const paid = t.installments.reduce((s, i) => {
      const pr = Array.isArray(i.payment_record) ? i.payment_record[0] : i.payment_record;
      return s + (pr?.paid_amount ? Number(pr.paid_amount) : 0);
    }, 0);
    const live = t.installments.filter((i) => !DEAD.has(i.status));
    const isDead = t.installments.length > 0 && live.length === 0;
    return {
      id: t.id,
      number: shortRequestNumber(t.request_number),
      title: t.title,
      createdAt: t.created_at,
      installmentCount: live.length,
      isDead,
      poValue,
      paid,
      balance: isDead ? 0 : Math.max(0, Math.round((poValue - paid) * 100) / 100),
    };
  });
  const counted = txns.filter((t) => !t.isDead);
  const totalPo = counted.reduce((s, t) => s + t.poValue, 0);
  const totalPaid = counted.reduce((s, t) => s + t.paid, 0);
  // Sum the per-row balances so the column adds up to its own total — netting
  // raw totals would let one overpaid thread cancel another's outstanding.
  const totalBalance = Math.round(counted.reduce((s, t) => s + t.balance, 0) * 100) / 100;

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
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-zinc-900 sm:text-2xl dark:text-zinc-50">{v.name}</h1>
            {canEdit && (
              <Link
                href={`/vendors/${v.id}/edit`}
                className="inline-flex items-center gap-1 rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:border-indigo-400 hover:text-indigo-700 dark:border-zinc-700 dark:text-zinc-300 dark:hover:text-indigo-300"
              >
                <PencilIcon />
                Edit
              </Link>
            )}
          </div>
          <p className="mt-1 text-sm text-zinc-500">
            Submitted by {v.submitter?.full_name ?? "—"} · {formatISTDate(v.created_at)}
          </p>
        </div>
        <div className="flex flex-col items-start gap-1 sm:items-end">
          <VendorStatusPill status={v.status} />
          {canApprove && v.status === "pending" && (
            <ApprovalPanel
              vendorId={v.id}
              hasBank={!!(v.bank_account_number && v.bank_ifsc)}
              hasPhone={!!v.phone}
            />
          )}
        </div>
      </div>

      {/* Money summary across the requests raised for this vendor */}
      <section className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MoneyTile
          label="PO value"
          value={totalPo}
          hint={`${counted.length} live request${counted.length === 1 ? "" : "s"}`}
        />
        <MoneyTile label="Paid" value={totalPaid} tone="emerald" />
        <MoneyTile label="Yet to pay" value={totalBalance} tone="amber" />
      </section>
      {!isStaff && txns.length > 0 && (
        <p className="mt-2 text-xs text-zinc-500">
          Covers only the requests you raised or were CC&rsquo;d on — not the vendor&rsquo;s
          company-wide totals.
        </p>
      )}
      {truncated && (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
          Showing the {THREAD_LIMIT} most recent requests — totals cover these only.
        </p>
      )}

      <section className="mt-6 grid grid-cols-1 gap-4 sm:mt-8 sm:grid-cols-2 sm:gap-6">
        <Card title="Tax IDs & contact">
          <Row label="GSTIN" value={v.gstin ?? "Not registered"} mono={!!v.gstin} />
          <Row label="PAN" value={v.pan} mono />
          <Row label="Mobile" value={v.phone ?? "—"} mono={!!v.phone} />
          <Row label="Email" value={v.email ?? "—"} />
        </Card>
        <Card title="Bank">
          {v.bank_account_number || v.bank_ifsc ? (
            <>
              <Row label="Account #" value={v.bank_account_number ?? "—"} mono={!!v.bank_account_number} />
              <Row label="IFSC" value={v.bank_ifsc ?? "—"} mono={!!v.bank_ifsc} />
              {v.bank_name && <Row label="Bank" value={v.bank_name} />}
              {v.bank_branch && <Row label="Branch" value={v.bank_branch} />}
            </>
          ) : (
            <p className="text-sm italic text-amber-700 dark:text-amber-300">
              Bank details pending. {canApprove ? "Fill them in below to approve." : "Accounts will add these when they approve."}
            </p>
          )}
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
          Approved by {v.verifier.full_name} · {v.verified_at ? formatISTDateTime(v.verified_at) : ""}
        </p>
      )}

      {/* Transactions */}
      <section className="mt-6 rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="border-b border-zinc-100 px-5 py-3 dark:border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Transactions <span className="font-normal text-zinc-500">({txns.length})</span>
          </h2>
        </div>

        {txns.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-zinc-500">
            No payment requests raised for this vendor yet.
          </p>
        ) : (
          <>
            {/* Mobile cards */}
            <ul className="divide-y divide-zinc-100 sm:hidden dark:divide-zinc-800">
              {txns.map((t) => (
                <li key={t.id}>
                  <Link href={`/requests/${t.id}`} className="block px-4 py-3 active:bg-zinc-50 dark:active:bg-zinc-800/60">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-mono text-xs font-medium text-indigo-600 dark:text-indigo-400">
                        {t.number}
                        {t.isDead && <span className="ml-1.5 font-sans text-[9px] font-semibold uppercase text-zinc-500">not proceeding</span>}
                      </span>
                      <span className="text-[11px] text-zinc-500">{formatISTDate(t.createdAt)}</span>
                    </div>
                    <p className="mt-0.5 truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {t.title || "—"}
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums">
                      <span className="text-zinc-500">PO <span className="text-zinc-900 dark:text-zinc-100">{formatINR(t.poValue)}</span></span>
                      <span className="text-zinc-500">Paid <span className="text-emerald-700 dark:text-emerald-400">{formatINR(t.paid)}</span></span>
                      <span className="text-zinc-500">Balance <span className="text-amber-700 dark:text-amber-400">{formatINR(t.balance)}</span></span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>

            {/* Desktop table */}
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full text-sm">
                <thead className="border-b border-zinc-100 text-left text-[11px] uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
                  <tr>
                    <th className="px-5 py-2">Request</th>
                    <th className="px-5 py-2">Raised</th>
                    <th className="px-5 py-2 text-center">Inst.</th>
                    <th className="px-5 py-2 text-right">PO value</th>
                    <th className="px-5 py-2 text-right">Paid</th>
                    <th className="px-5 py-2 text-right">Yet to pay</th>
                  </tr>
                </thead>
                <tbody>
                  {txns.map((t) => (
                    <tr key={t.id} className="border-b border-zinc-50 last:border-b-0 dark:border-zinc-800/60">
                      <td className="px-5 py-2">
                        <Link href={`/requests/${t.id}`} className="font-mono text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                          {t.number}
                        </Link>
                        {t.isDead && (
                          <span className="ml-1.5 rounded-full bg-zinc-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-zinc-500 dark:bg-zinc-800">
                            not proceeding
                          </span>
                        )}
                        {t.title && <div className="truncate text-xs text-zinc-500">{t.title}</div>}
                      </td>
                      <td className="px-5 py-2 text-xs text-zinc-500">{formatISTDate(t.createdAt)}</td>
                      <td className="px-5 py-2 text-center text-xs text-zinc-500">{t.installmentCount}</td>
                      <td className={`px-5 py-2 text-right tabular-nums ${t.isDead ? "text-zinc-400 line-through" : ""}`}>{formatINR(t.poValue)}</td>
                      <td className="px-5 py-2 text-right tabular-nums text-emerald-700 dark:text-emerald-400">{formatINR(t.paid)}</td>
                      <td className="px-5 py-2 text-right tabular-nums text-amber-700 dark:text-amber-400">{formatINR(t.balance)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-zinc-200 font-semibold dark:border-zinc-700">
                    <td className="px-5 py-2 text-xs uppercase tracking-wide text-zinc-500" colSpan={3}>Total</td>
                    <td className="px-5 py-2 text-right tabular-nums">{formatINR(totalPo)}</td>
                    <td className="px-5 py-2 text-right tabular-nums text-emerald-700 dark:text-emerald-400">{formatINR(totalPaid)}</td>
                    <td className="px-5 py-2 text-right tabular-nums text-amber-700 dark:text-amber-400">{formatINR(totalBalance)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function MoneyTile({
  label,
  value,
  hint,
  tone = "zinc",
}: {
  label: string;
  value: number;
  hint?: string;
  tone?: "zinc" | "emerald" | "amber";
}) {
  const color =
    tone === "emerald"
      ? "text-emerald-700 dark:text-emerald-400"
      : tone === "amber"
        ? "text-amber-700 dark:text-amber-400"
        : "text-zinc-900 dark:text-zinc-100";
  return (
    <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">{label}</p>
      <p className={`mt-0.5 text-lg font-semibold tabular-nums ${color}`}>{formatINR(value)}</p>
      {hint && <p className="text-[11px] text-zinc-500">{hint}</p>}
    </div>
  );
}

function PencilIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
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
