import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUserRoles, requireUser } from "@/lib/auth";
import { STATUS_LABEL, formatINR, PAYMENT_MODE_LABEL, VENDOR_STATUS_LABEL } from "@/lib/routing";

const DOC_TYPE_LABEL: Record<"po" | "invoice" | "no_invoice" | "invoice_pending", string> = {
  po: "PO",
  invoice: "Invoice",
  no_invoice: "No Invoice",
  invoice_pending: "Invoice Yet to Receive",
};
import RequestActions from "./request-actions";
import DiscussionThread from "./discussion";
import type { CommentItem, ThreadAttachment } from "./discussion";

type ReqRow = {
  id: string;
  request_number: string;
  status: string;
  submitter_id: string;
  vendor_id: string;
  document_type: "po" | "invoice" | "no_invoice" | "invoice_pending" | null;
  document_reference: string | null;
  total_bill_value: number;
  payment_amount: number;
  payment_percentage: number | null;
  previous_payments: number;
  balance_payable: number;
  payment_due_date: string;
  date_of_work_completion: string | null;
  tentative_invoice_date: string | null;
  purpose: string;
  submitted_at: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  return_reason: string | null;
  created_at: string;
  submitter: { full_name: string; email: string } | null;
  vendor: { name: string; gstin: string | null; status: string; bank_account_number: string | null; bank_ifsc: string | null } | null;
  approver: { full_name: string } | null;
  outlets: { outlet: { name: string; code: string } | null }[];
};

type LineItemRow = {
  id: string;
  description: string | null;
  quantity: number;
  rate: number;
  amount: number;
  sort_order: number;
  coa_account: { id: string; subcategory: string; category: string; coa: string } | null;
};

export default async function RequestDetailPage({
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
      `id, request_number, status, submitter_id, vendor_id,
       document_type, document_reference, total_bill_value,
       payment_amount, payment_percentage, previous_payments, balance_payable,
       payment_due_date, date_of_work_completion, tentative_invoice_date,
       purpose,
       submitted_at, approved_at, rejection_reason, return_reason, created_at,
       submitter:profiles!payment_requests_submitter_id_fkey(full_name, email),
       vendor:vendors(name, gstin, status, bank_account_number, bank_ifsc),
       approver:profiles!payment_requests_approver_id_fkey(full_name),
       outlets:request_outlets(outlet:outlets(name, code))`,
    )
    .eq("id", id)
    .maybeSingle();

  if (!data) notFound();
  const req = data as unknown as ReqRow;

  const isSubmitter = user!.id === req.submitter_id;
  const isApprover = roles.includes("approver");
  const isAccounts = roles.includes("accounts");
  const isAdmin = roles.includes("admin");

  // Payment record + status history + attachments + comments + coa options + line items
  const [payRes, historyRes, attRes, commentRes, coaRes, mentionCandRes, lineRes] = await Promise.all([
    supabase.from("payment_records").select("*").eq("request_id", id).maybeSingle(),
    supabase
      .from("status_history")
      .select("id, from_status, to_status, comment, created_at, actor:profiles(full_name)")
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
        `id, description, quantity, rate, amount, sort_order,
         coa_account:coa_accounts(id, subcategory, category, coa)`,
      )
      .eq("request_id", id)
      .order("sort_order"),
  ]);

  const lineItems = (lineRes.data ?? []) as unknown as LineItemRow[];

  const paymentRecord = payRes.data as {
    bank_upload_date: string | null;
    bank_batch_ref: string | null;
    payment_date: string | null;
    paid_amount: number | null;
    utr_reference: string | null;
    payment_mode: string | null;
    paying_bank_account: string | null;
  } | null;

  const history = (historyRes.data ?? []) as unknown as {
    id: string;
    from_status: string | null;
    to_status: string;
    comment: string | null;
    created_at: string;
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

  // Also fetch comment-linked attachments (attachments where comment_id != null,
  // for comments on this request). RLS ensures we only see visible ones.
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

  // Sign URLs for everything upfront (1 hour)
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
  const paymentStageAtt = rawAttachments.filter((a) => a.stage === "payment");
  const invoiceStageAtt = rawAttachments.filter((a) => a.stage === "invoice");

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

  return (
    <div>
      <div className="mb-4 text-sm">
        <Link href={isSubmitter ? "/requests" : "/approvals"} className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
          ← Back
        </Link>
      </div>

      {/* Header — stacks on mobile, side-by-side on desktop */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="min-w-0">
          <p className="font-mono text-xs text-zinc-500">{req.request_number}</p>
          <h1 className="mt-1 text-xl font-semibold text-zinc-900 sm:text-2xl dark:text-zinc-50">
            {req.vendor?.name}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusPill status={req.status} />
            {req.vendor?.status !== "approved" && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-900 dark:text-amber-200">
                Vendor {VENDOR_STATUS_LABEL[req.vendor?.status ?? ""] ?? req.vendor?.status}
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
        <div className="flex items-baseline gap-3 sm:flex-col sm:items-end sm:gap-0 sm:text-right">
          <p className="text-2xl font-semibold text-zinc-900 tabular-nums sm:text-3xl dark:text-zinc-50">
            {formatINR(req.payment_amount)}
          </p>
          <p className="text-xs text-zinc-500 sm:mt-1">Due {req.payment_due_date}</p>
        </div>
      </div>

      {/* Actions */}
      <div className="mt-6">
        <RequestActions
          requestId={req.id}
          status={req.status}
          vendorStatus={req.vendor?.status ?? "approved"}
          isSubmitter={isSubmitter}
          isApprover={isApprover}
          isAccounts={isAccounts}
          isAdmin={isAdmin}
          coaHeads={coaHeads}
          lineItems={lineItems.map((l) => ({
            id: l.id,
            coa_account_id: l.coa_account?.id ?? "",
            label: l.coa_account?.subcategory ?? "—",
          }))}
        />
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          {/* Commercial */}
          <Card title="Commercial">
            <Grid>
              <Row label="Total bill" value={formatINR(req.total_bill_value)} mono />
              <Row label="This payment" value={formatINR(req.payment_amount)} mono />
              <Row
                label="Previous payments"
                value={req.previous_payments ? formatINR(req.previous_payments) : "—"}
                mono
              />
              <Row label="Balance after" value={formatINR(req.balance_payable)} mono />
              {req.payment_percentage != null && (
                <Row label="% requested" value={`${req.payment_percentage}%`} />
              )}
              <Row label="Payment due" value={req.payment_due_date} />
              {req.date_of_work_completion && (
                <Row label="Work completed" value={req.date_of_work_completion} />
              )}
              {req.tentative_invoice_date && (
                <Row label="Tentative invoice" value={req.tentative_invoice_date} />
              )}
              {req.document_type && <Row label="Document" value={DOC_TYPE_LABEL[req.document_type]} />}
              {req.document_reference && <Row label="Doc #" value={req.document_reference} mono />}
            </Grid>
          </Card>

          {/* Line items */}
          <Card title={`Line items (${lineItems.length})`}>
            {/* Desktop table */}
            <div className="hidden sm:block">
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
                      Total
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-sm font-semibold text-zinc-900 tabular-nums dark:text-zinc-100">
                      {formatINR(lineItems.reduce((s, l) => s + Number(l.amount), 0))}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Mobile stacked cards */}
            <div className="space-y-2 sm:hidden">
              {lineItems.map((l, idx) => (
                <div
                  key={l.id}
                  className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/40"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[10px] uppercase tracking-wide text-zinc-500">
                        Line {idx + 1}
                      </p>
                      <p className="mt-0.5 font-medium text-zinc-900 dark:text-zinc-100">
                        {l.coa_account?.subcategory ?? "—"}
                      </p>
                      <p className="text-[11px] text-zinc-500">
                        {l.coa_account?.category} · {l.coa_account?.coa}
                      </p>
                    </div>
                    <p className="whitespace-nowrap font-mono text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                      {formatINR(l.amount)}
                    </p>
                  </div>
                  <p className="mt-2 text-[11px] text-zinc-500 tabular-nums">
                    {l.quantity} × {formatINR(l.rate)}
                  </p>
                </div>
              ))}
              <div className="flex items-baseline justify-between rounded-lg bg-indigo-50 px-3 py-2 dark:bg-indigo-950/40">
                <span className="text-xs font-semibold uppercase tracking-wide text-indigo-700 dark:text-indigo-200">
                  Total
                </span>
                <span className="font-mono text-base font-semibold tabular-nums text-indigo-900 dark:text-indigo-100">
                  {formatINR(lineItems.reduce((s, l) => s + Number(l.amount), 0))}
                </span>
              </div>
            </div>
          </Card>

          {/* Purpose */}
          <Card title="Purpose">
            <p className="whitespace-pre-wrap text-sm text-zinc-800 dark:text-zinc-200">{req.purpose}</p>
          </Card>

          {/* Attachments — Request stage */}
          {requestStageAtt.length > 0 && (
            <Card title={`Documents — request (${requestStageAtt.length})`}>
              <AttachmentsGrid items={requestStageAtt} urlByPath={urlByPath} />
            </Card>
          )}
          {paymentStageAtt.length > 0 && (
            <Card title={`Documents — payment proof (${paymentStageAtt.length})`}>
              <AttachmentsGrid items={paymentStageAtt} urlByPath={urlByPath} />
            </Card>
          )}
          {invoiceStageAtt.length > 0 && (
            <Card title={`Documents — invoice (${invoiceStageAtt.length})`}>
              <AttachmentsGrid items={invoiceStageAtt} urlByPath={urlByPath} />
            </Card>
          )}

          {/* Reject / Return reasons */}
          {req.rejection_reason && (
            <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm dark:border-red-900 dark:bg-red-950/40">
              <p className="text-xs font-semibold uppercase tracking-wide text-red-700">Reason for rejection</p>
              <p className="mt-1 text-red-900 dark:text-red-100">{req.rejection_reason}</p>
            </div>
          )}
          {req.return_reason && req.status === "returned_for_correction" && (
            <div className="rounded-md border border-orange-200 bg-orange-50 p-4 text-sm dark:border-orange-900 dark:bg-orange-950/40">
              <p className="text-xs font-semibold uppercase tracking-wide text-orange-700">Returned for correction</p>
              <p className="mt-1 text-orange-900 dark:text-orange-100">{req.return_reason}</p>
            </div>
          )}

          {/* Discussion */}
          <DiscussionThread requestId={req.id} comments={comments} candidates={mentionCandidates} />

          {/* Payment record */}
          {paymentRecord && (paymentRecord.payment_date || paymentRecord.bank_upload_date) && (
            <Card title="Payment record">
              <Grid>
                {paymentRecord.bank_upload_date && (
                  <Row label="Bank upload date" value={paymentRecord.bank_upload_date} />
                )}
                {paymentRecord.bank_batch_ref && (
                  <Row label="Bank batch ref" value={paymentRecord.bank_batch_ref} mono />
                )}
                {paymentRecord.payment_date && (
                  <Row label="Payment date" value={paymentRecord.payment_date} />
                )}
                {paymentRecord.paid_amount != null && (
                  <Row label="Amount paid" value={formatINR(paymentRecord.paid_amount)} mono />
                )}
                {paymentRecord.utr_reference && (
                  <Row label="UTR" value={paymentRecord.utr_reference} mono />
                )}
                {paymentRecord.payment_mode && (
                  <Row label="Mode" value={PAYMENT_MODE_LABEL[paymentRecord.payment_mode] ?? paymentRecord.payment_mode} />
                )}
                {paymentRecord.paying_bank_account && (
                  <Row label="Paid from" value={paymentRecord.paying_bank_account} mono />
                )}
              </Grid>
            </Card>
          )}
        </div>

        {/* Right column: timeline */}
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

          {/* Vendor summary */}
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
