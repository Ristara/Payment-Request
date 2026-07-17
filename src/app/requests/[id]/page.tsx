import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUserRoles, requireUser } from "@/lib/auth";
import { STATUS_LABEL, formatINR, PAYMENT_MODE_LABEL, VENDOR_STATUS_LABEL } from "@/lib/routing";
import InstallmentActions from "./installment-actions";
import RaiseInstallmentPanel from "./raise-installment";
import DiscussionThread from "./discussion";
import type { CommentItem, ThreadAttachment } from "./discussion";

const DOC_TYPE_LABEL: Record<"po" | "invoice" | "no_invoice" | "invoice_pending", string> = {
  po: "PO",
  invoice: "Invoice",
  no_invoice: "No Invoice",
  invoice_pending: "Invoice Yet to Receive",
};

type ThreadRow = {
  id: string;
  request_number: string;
  submitter_id: string;
  vendor_id: string;
  document_type: "po" | "invoice" | "no_invoice" | "invoice_pending" | null;
  document_reference: string | null;
  purpose: string;
  created_at: string;
  submitter: { full_name: string; email: string } | null;
  vendor: { name: string; gstin: string | null; status: string; bank_account_number: string | null; bank_ifsc: string | null } | null;
  outlets: { outlet: { name: string; code: string } | null }[];
};

type LineItemRow = {
  id: string;
  quantity: number;
  rate: number;
  amount: number;
  sort_order: number;
  coa_account: { id: string; subcategory: string; category: string; coa: string } | null;
};

type InstallmentRow = {
  id: string;
  installment_number: number;
  requested_amount: number;
  payment_due_date: string;
  date_of_work_completion: string | null;
  tentative_invoice_date: string | null;
  purpose: string | null;
  status: string;
  submitted_by: string;
  submitted_at: string;
  approver_id: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  return_reason: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  approver: { full_name: string } | null;
  submitter: { full_name: string } | null;
  payment_record: PaymentRecord | null;
};

type PaymentRecord = {
  bank_upload_date: string | null;
  bank_batch_ref: string | null;
  payment_date: string | null;
  paid_amount: number | null;
  utr_reference: string | null;
  payment_mode: string | null;
  paying_bank_account: string | null;
};

export default async function ThreadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireUser();
  const { user, roles } = await getCurrentUserRoles();
  const supabase = await createClient();
  const admin = createAdminClient();

  const { data } = await supabase
    .from("payment_requests")
    .select(
      `id, request_number, submitter_id, vendor_id,
       document_type, document_reference, purpose, created_at,
       submitter:profiles!payment_requests_submitter_id_fkey(full_name, email),
       vendor:vendors(name, gstin, status, bank_account_number, bank_ifsc),
       outlets:request_outlets(outlet:outlets(name, code))`,
    )
    .eq("id", id)
    .maybeSingle();

  if (!data) notFound();
  const req = data as unknown as ThreadRow;

  const isSubmitter = user!.id === req.submitter_id;
  const isApprover = roles.includes("approver");
  const isAccounts = roles.includes("accounts");
  const isAdmin = roles.includes("admin");

  const [instRes, historyRes, attRes, commentRes, coaRes, mentionCandRes, lineRes] = await Promise.all([
    supabase
      .from("request_installments")
      .select(
        `id, installment_number, requested_amount, payment_due_date, date_of_work_completion,
         tentative_invoice_date, purpose, status, submitted_by, submitted_at, approver_id,
         approved_at, rejection_reason, return_reason, cancelled_at, cancellation_reason,
         approver:profiles!request_installments_approver_id_fkey(full_name),
         submitter:profiles!request_installments_submitted_by_fkey(full_name),
         payment_record:payment_records(bank_upload_date, bank_batch_ref, payment_date, paid_amount, utr_reference, payment_mode, paying_bank_account)`,
      )
      .eq("request_id", id)
      .order("installment_number"),
    supabase
      .from("status_history")
      .select("id, from_status, to_status, comment, created_at, installment_id, actor:profiles(full_name)")
      .eq("request_id", id)
      .order("created_at"),
    supabase
      .from("attachments")
      .select("id, storage_path, file_name, file_size_bytes, mime_type, stage, comment_id, uploaded_by")
      .eq("request_id", id)
      .order("uploaded_at"),
    supabase
      .from("comments")
      .select(
        `id, body, created_at, author_id, is_question, question_state,
         author:profiles!comments_author_id_fkey(full_name, email),
         mentions:comment_mentions(mentioned_user_id, mentioned:profiles!comment_mentions_mentioned_user_id_fkey(full_name))`,
      )
      .eq("request_id", id)
      .order("created_at"),
    supabase.from("coa_accounts").select("id, code, subcategory, category, coa").eq("is_active", true).order("subcategory"),
    supabase.from("profiles").select("id, full_name, email").eq("is_active", true).order("full_name"),
    supabase
      .from("request_line_items")
      .select(
        `id, quantity, rate, amount, sort_order,
         coa_account:coa_accounts(id, subcategory, category, coa)`,
      )
      .eq("request_id", id)
      .order("sort_order"),
  ]);

  const lineItems = (lineRes.data ?? []) as unknown as LineItemRow[];
  const installments = ((instRes.data ?? []) as unknown as InstallmentRow[]).map((i) => ({
    ...i,
    payment_record: Array.isArray(i.payment_record) ? (i.payment_record[0] ?? null) : i.payment_record,
  }));

  const poValue = lineItems.reduce((s, l) => s + Number(l.amount), 0);
  const paidTotal = installments.reduce(
    (s, i) => s + (i.payment_record?.paid_amount ? Number(i.payment_record.paid_amount) : 0),
    0,
  );
  const requestedTotal = installments
    .filter((i) => i.status !== "cancelled" && i.status !== "rejected")
    .reduce((s, i) => s + Number(i.requested_amount), 0);
  const balanceRemaining = Math.max(0, Math.round((poValue - requestedTotal) * 100) / 100);

  const history = (historyRes.data ?? []) as unknown as {
    id: string;
    from_status: string | null;
    to_status: string;
    comment: string | null;
    created_at: string;
    installment_id: string | null;
    actor: { full_name: string } | null;
  }[];

  const rawAttachments = (attRes.data ?? []) as {
    id: string;
    storage_path: string;
    file_name: string;
    file_size_bytes: number;
    mime_type: string | null;
    stage: string;
    comment_id: string | null;
    uploaded_by: string;
  }[];

  const commentIds = (commentRes.data ?? []).map((c: unknown) => (c as { id: string }).id);
  const { data: commentAtts } = commentIds.length
    ? await supabase
        .from("attachments")
        .select("id, comment_id, storage_path, file_name, file_size_bytes, mime_type")
        .in("comment_id", commentIds)
    : { data: [] as {
        id: string;
        comment_id: string;
        storage_path: string;
        file_name: string;
        file_size_bytes: number;
        mime_type: string | null;
      }[] };

  const allPaths = [
    ...rawAttachments.map((a) => a.storage_path),
    ...(commentAtts ?? []).map((a) => a.storage_path),
  ];
  const urlByPath = new Map<string, string>();
  await Promise.all(
    allPaths.map(async (path) => {
      const { data: signed } = await admin.storage.from("request-attachments").createSignedUrl(path, 3600);
      if (signed?.signedUrl) urlByPath.set(path, signed.signedUrl);
    }),
  );

  const requestStageAtt = rawAttachments.filter((a) => a.stage === "request");

  const commentAttsByComment = new Map<string, ThreadAttachment[]>();
  for (const a of commentAtts ?? []) {
    const list = commentAttsByComment.get(a.comment_id) ?? [];
    list.push({
      id: a.id,
      file_name: a.file_name,
      file_size_bytes: a.file_size_bytes,
      mime_type: a.mime_type,
      url: urlByPath.get(a.storage_path) ?? null,
    });
    commentAttsByComment.set(a.comment_id, list);
  }

  type RawComment = {
    id: string;
    body: string;
    created_at: string;
    author_id: string;
    is_question: boolean | null;
    question_state: string | null;
    author: { full_name: string; email: string } | null;
    mentions: { mentioned: { full_name: string } | null }[];
  };
  const rawComments = (commentRes.data ?? []) as unknown as RawComment[];
  const comments: CommentItem[] = rawComments.map((c) => ({
    id: c.id,
    body: c.body,
    created_at: c.created_at,
    author_id: c.author_id,
    author_name: c.author?.full_name ?? "—",
    author_email: c.author?.email ?? "",
    is_me: c.author_id === user!.id,
    is_question: !!c.is_question,
    question_state: c.question_state ?? null,
    mentioned_names: (c.mentions ?? []).map((m) => m.mentioned?.full_name ?? "").filter(Boolean),
    attachments: commentAttsByComment.get(c.id) ?? [],
  }));

  const coaHeads = (coaRes.data ?? []) as { id: string; code: number; subcategory: string; category: string; coa: string }[];
  const mentionCandidates = ((mentionCandRes.data ?? []) as {
    id: string;
    full_name: string;
    email: string;
  }[]).filter((p) => p.id !== user!.id);

  // Thread status = the most-recent-installment's status (surfaced as a tag)
  const latest = installments[installments.length - 1];
  const threadStatus = latest?.status ?? "draft";

  // Whether the submitter can raise another installment.
  const canRaiseInstallment = isSubmitter && balanceRemaining > 0.005;

  return (
    <div>
      <div className="mb-4 text-sm">
        <Link href={isSubmitter ? "/requests" : "/approvals"} className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
          ← Back
        </Link>
      </div>

      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="min-w-0">
          <p className="font-mono text-xs text-zinc-500">{req.request_number}</p>
          <h1 className="mt-1 text-xl font-semibold text-zinc-900 sm:text-2xl dark:text-zinc-50">
            {req.vendor?.name}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusPill status={threadStatus} />
            {req.vendor?.status !== "approved" && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-900 dark:text-amber-200">
                Vendor {VENDOR_STATUS_LABEL[req.vendor?.status ?? ""] ?? req.vendor?.status}
              </span>
            )}
            {req.document_type && (
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                {DOC_TYPE_LABEL[req.document_type]}
                {req.document_reference && ` · ${req.document_reference}`}
              </span>
            )}
          </div>
          <p className="mt-2 text-xs text-zinc-500 sm:text-sm">
            Raised by {req.submitter?.full_name} · {new Date(req.created_at).toLocaleDateString()}
          </p>
          {req.outlets.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {req.outlets.map((ro, i) => (
                <span
                  key={i}
                  className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                >
                  {ro.outlet?.name}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="grid grid-cols-3 gap-3 sm:flex-col sm:items-end sm:text-right">
          <MoneyChip label="PO value" value={poValue} />
          <MoneyChip label="Paid" value={paidTotal} tone="emerald" />
          <MoneyChip label="Balance" value={balanceRemaining} tone={balanceRemaining > 0 ? "amber" : "zinc"} />
        </div>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          {/* Line items = PO breakdown */}
          <Card title={`Line items (${lineItems.length})`}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left text-[11px] uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
                    <th className="px-2 py-2 font-medium">Subcategory</th>
                    <th className="px-2 py-2 text-right font-medium">Qty</th>
                    <th className="px-2 py-2 text-right font-medium">Rate</th>
                    <th className="px-2 py-2 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {lineItems.map((l) => (
                    <tr key={l.id} className="border-b border-zinc-100 align-top dark:border-zinc-800/60">
                      <td className="px-2 py-2">
                        <div className="font-medium text-zinc-900 dark:text-zinc-100">
                          {l.coa_account?.subcategory ?? "—"}
                        </div>
                        <div className="text-[11px] text-zinc-500">
                          {l.coa_account?.category} · {l.coa_account?.coa}
                        </div>
                      </td>
                      <td className="px-2 py-2 text-right font-mono text-xs tabular-nums">{l.quantity}</td>
                      <td className="px-2 py-2 text-right font-mono text-xs tabular-nums">{formatINR(l.rate)}</td>
                      <td className="px-2 py-2 text-right font-mono text-xs tabular-nums font-semibold">
                        {formatINR(l.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3} className="px-2 py-2 text-right text-xs uppercase tracking-wide text-zinc-500">
                      PO value
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-sm font-semibold text-zinc-900 tabular-nums dark:text-zinc-100">
                      {formatINR(poValue)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>

          {/* Purpose */}
          <Card title="Purpose">
            <p className="whitespace-pre-wrap text-sm text-zinc-800 dark:text-zinc-200">{req.purpose}</p>
          </Card>

          {/* Installments — Gmail-style thread */}
          <Card title={`Installments (${installments.length})`}>
            <ul className="space-y-4">
              {installments.map((inst) => (
                <li
                  key={inst.id}
                  className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-zinc-500">
                        Installment #{inst.installment_number}
                      </p>
                      <p className="mt-0.5 font-mono text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                        {formatINR(inst.requested_amount)}
                      </p>
                    </div>
                    <StatusPill status={inst.status} />
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1 text-xs text-zinc-600 sm:grid-cols-2 dark:text-zinc-400">
                    <p>Due {inst.payment_due_date}</p>
                    <p>Raised by {inst.submitter?.full_name ?? "—"} · {new Date(inst.submitted_at).toLocaleDateString()}</p>
                    {inst.date_of_work_completion && <p>Work completed {inst.date_of_work_completion}</p>}
                    {inst.tentative_invoice_date && <p>Tentative invoice {inst.tentative_invoice_date}</p>}
                    {inst.approved_at && inst.approver && (
                      <p>Approved by {inst.approver.full_name} · {new Date(inst.approved_at).toLocaleDateString()}</p>
                    )}
                  </div>
                  {inst.rejection_reason && (
                    <p className="mt-2 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
                      Rejected: {inst.rejection_reason}
                    </p>
                  )}
                  {inst.return_reason && inst.status === "returned_for_correction" && (
                    <p className="mt-2 rounded-md border border-orange-200 bg-orange-50 p-2 text-xs text-orange-800 dark:border-orange-900 dark:bg-orange-950/40 dark:text-orange-200">
                      Returned: {inst.return_reason}
                    </p>
                  )}
                  {inst.payment_record && (inst.payment_record.payment_date || inst.payment_record.bank_upload_date) && (
                    <div className="mt-3 rounded-md bg-emerald-50 p-3 text-xs dark:bg-emerald-950/40">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                        Payment
                      </p>
                      <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-emerald-900 dark:text-emerald-100">
                        {inst.payment_record.payment_date && <p>Paid on {inst.payment_record.payment_date}</p>}
                        {inst.payment_record.paid_amount != null && (
                          <p className="font-mono tabular-nums">{formatINR(inst.payment_record.paid_amount)}</p>
                        )}
                        {inst.payment_record.utr_reference && (
                          <p className="col-span-2 font-mono">UTR: {inst.payment_record.utr_reference}</p>
                        )}
                        {inst.payment_record.payment_mode && (
                          <p>Mode: {PAYMENT_MODE_LABEL[inst.payment_record.payment_mode] ?? inst.payment_record.payment_mode}</p>
                        )}
                        {inst.payment_record.paying_bank_account && (
                          <p>Paid from: {inst.payment_record.paying_bank_account}</p>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="mt-3">
                    <InstallmentActions
                      installmentId={inst.id}
                      requestId={req.id}
                      status={inst.status}
                      vendorStatus={req.vendor?.status ?? "approved"}
                      isSubmitter={isSubmitter}
                      isApprover={isApprover}
                      isAccounts={isAccounts}
                      isAdmin={isAdmin}
                    />
                  </div>
                </li>
              ))}
            </ul>

            {canRaiseInstallment && (
              <div className="mt-6 border-t border-zinc-200 pt-6 dark:border-zinc-800">
                <RaiseInstallmentPanel
                  requestId={req.id}
                  poValue={poValue}
                  requestedTotal={requestedTotal}
                  balanceRemaining={balanceRemaining}
                  nextInstallmentNumber={installments.length + 1}
                />
              </div>
            )}
            {!canRaiseInstallment && balanceRemaining <= 0.005 && (
              <p className="mt-4 text-center text-xs text-zinc-500">
                PO fully requested. No balance remaining.
              </p>
            )}
          </Card>

          {/* Attachments — Request stage */}
          {requestStageAtt.length > 0 && (
            <Card title={`Supporting documents (${requestStageAtt.length})`}>
              <AttachmentsGrid items={requestStageAtt} urlByPath={urlByPath} />
            </Card>
          )}

          {/* Discussion */}
          <DiscussionThread requestId={req.id} comments={comments} candidates={mentionCandidates} />
        </div>

        {/* Right column: timeline + vendor */}
        <aside className="space-y-6">
          <Card title="Timeline">
            <ol className="mt-2 space-y-3 text-sm">
              {history.map((h) => (
                <li key={h.id} className="border-l-2 border-zinc-200 pl-3 dark:border-zinc-700">
                  <p className="text-xs font-medium text-zinc-900 dark:text-zinc-100">
                    {STATUS_LABEL[h.to_status] ?? h.to_status}
                  </p>
                  <p className="text-xs text-zinc-500">
                    {h.actor?.full_name ?? "—"} · {new Date(h.created_at).toLocaleString()}
                  </p>
                  {h.comment && (
                    <p className="mt-1 text-xs text-zinc-700 dark:text-zinc-300">{h.comment}</p>
                  )}
                </li>
              ))}
            </ol>
          </Card>

          <Card title="Vendor">
            <Grid>
              <Row label="Name" value={req.vendor?.name ?? "—"} />
              <Row label="GSTIN" value={req.vendor?.gstin ?? "Not registered"} mono={!!req.vendor?.gstin} />
              <Row label="A/C" value={req.vendor?.bank_account_number ?? "—"} mono />
              <Row label="IFSC" value={req.vendor?.bank_ifsc ?? "—"} mono />
            </Grid>
          </Card>
        </aside>
      </div>

      {/* Suppress unused var warnings for coaHeads if not used elsewhere */}
      {false && coaHeads.length}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}
function Grid({ children }: { children: React.ReactNode }) {
  return <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">{children}</dl>;
}
function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <>
      <dt className="text-zinc-500">{label}</dt>
      <dd className={`text-right text-zinc-900 dark:text-zinc-100 ${mono ? "font-mono text-xs" : ""}`}>{value}</dd>
    </>
  );
}

function MoneyChip({ label, value, tone = "zinc" }: { label: string; value: number; tone?: "emerald" | "amber" | "zinc" }) {
  const bg =
    tone === "emerald"
      ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100"
      : tone === "amber"
        ? "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
        : "bg-zinc-50 text-zinc-800 dark:bg-zinc-900 dark:text-zinc-100";
  return (
    <div className={`rounded-lg px-3 py-2 text-right ${bg}`}>
      <p className="text-[10px] font-medium uppercase tracking-wide opacity-70">{label}</p>
      <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums">{formatINR(value)}</p>
    </div>
  );
}

function AttachmentsGrid({
  items,
  urlByPath,
}: {
  items: { id: string; storage_path: string; file_name: string; file_size_bytes: number; mime_type: string | null }[];
  urlByPath: Map<string, string>;
}) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {items.map((a) => {
        const url = urlByPath.get(a.storage_path);
        const isImage = (a.mime_type ?? "").startsWith("image/");
        return (
          <li key={a.id} className="overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-800">
            {url ? (
              <a href={url} target="_blank" rel="noopener noreferrer" className="block">
                {isImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={url} alt={a.file_name} className="aspect-square w-full object-cover" />
                ) : (
                  <div className="flex aspect-square items-center justify-center bg-zinc-50 text-4xl dark:bg-zinc-800">📄</div>
                )}
                <p className="truncate px-2 py-1 text-[11px] text-zinc-700 dark:text-zinc-300">{a.file_name}</p>
              </a>
            ) : (
              <p className="p-2 text-xs text-zinc-500">{a.file_name}</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function StatusPill({ status, className = "" }: { status: string; className?: string }) {
  const color =
    status === "closed" || status === "payment_processed"
      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200"
      : status === "rejected" || status === "cancelled"
        ? "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-200"
        : status === "returned_for_correction" || status === "clarification_required"
          ? "bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-200"
          : status === "approved" || status === "uploaded_in_bank" || status === "invoice_pending"
            ? "bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-200"
            : "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-200";
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-medium ${color} ${className}`}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}
