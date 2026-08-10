import Link from "next/link";
import { COA_LABEL } from "@/lib/coa-labels";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUserRoles, requireUser } from "@/lib/auth";
import { STATUS_LABEL, formatINR, PAYMENT_MODE_LABEL, VENDOR_STATUS_LABEL } from "@/lib/routing";
import { formatDateOnly, formatISTDate, formatISTDateTime, shortRequestNumber } from "@/lib/types";
import InstallmentActions from "./installment-actions";
import DeleteRequest from "./delete-request";
import RaiseInstallmentPanel from "./raise-installment";
import MarkRead from "./mark-read";
import DiscussionThread from "./discussion";
import EditPayment from "./edit-payment";
import CcPanel from "./cc-panel";
import EditLineItems from "./edit-line-items";
import { deleteAttachment } from "@/app/requests/actions";
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
  title: string | null;
  submitter_id: string;
  vendor_id: string;
  document_type: "po" | "invoice" | "no_invoice" | "invoice_pending" | null;
  document_reference: string | null;
  payment_kind: "regular" | "milestone" | null;
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
  tds_amount: number | null;
  tds_section: string | null;
  tds_section_id: string | null;
  queued_for_upload_at: string | null;
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
  id: string;
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

  // One parallel wave — every query filters by the route id alone, so the
  // main thread row doesn't need to resolve first.
  const [threadRes, instRes, historyRes, attRes, commentRes, mentionCandRes, coaRes, lineRes] = await Promise.all([
    supabase
      .from("payment_requests")
      .select(
        `id, request_number, title, submitter_id, vendor_id,
         document_type, document_reference, payment_kind, purpose, created_at,
         submitter:profiles!payment_requests_submitter_id_fkey(full_name, email),
         vendor:vendors(name, gstin, status, bank_account_number, bank_ifsc),
         outlets:request_outlets(outlet:outlets(name, code))`,
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("request_installments")
      .select(
        `id, installment_number, requested_amount, tds_amount, tds_section, tds_section_id, queued_for_upload_at, payment_due_date, date_of_work_completion,
         tentative_invoice_date, purpose, status, submitted_by, submitted_at, approver_id,
         approved_at, rejection_reason, return_reason, cancelled_at, cancellation_reason,
         approver:profiles!request_installments_approver_id_fkey(full_name),
         submitter:profiles!request_installments_submitted_by_fkey(full_name),
         payment_record:payment_records(id, bank_upload_date, bank_batch_ref, payment_date, paid_amount, utr_reference, payment_mode, paying_bank_account)`,
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
        `id, body, created_at, author_id,
         author:profiles!comments_author_id_fkey(full_name, email),
         mentions:comment_mentions(mentioned_user_id, mentioned:profiles!comment_mentions_mentioned_user_id_fkey(full_name)),
         attachments:attachments(id, storage_path, file_name, file_size_bytes, mime_type)`,
      )
      .eq("request_id", id)
      .order("created_at"),
    supabase.from("profiles").select("id, full_name, email").eq("is_active", true).order("full_name"),
    supabase
      .from("coa_accounts")
      .select("id, subcategory, category, coa")
      .eq("is_active", true)
      .order("coa"),
    supabase
      .from("request_line_items")
      .select(
        `id, quantity, rate, amount, sort_order,
         coa_account:coa_accounts(id, subcategory, category, coa)`,
      )
      .eq("request_id", id)
      .order("sort_order"),
  ]);

  if (!threadRes.data) notFound();
  const req = threadRes.data as unknown as ThreadRow;

  const isSubmitter = user!.id === req.submitter_id;
  // Being CC'd is how a second person picks a request up — they carry it
  // forward the same way the person who raised it would.
  // The whole list, not just my own row: the page now shows who else can see
  // this, which was previously invisible to everyone including the submitter.
  const { data: watcherRows } = await supabase
    .from("request_watchers")
    .select("user_id, watcher:profiles!request_watchers_user_id_fkey(full_name)")
    .eq("request_id", req.id);
  const watchers = ((watcherRows ?? []) as unknown as {
    user_id: string;
    watcher: { full_name: string } | { full_name: string }[] | null;
  }[]).map((w) => {
    const p = Array.isArray(w.watcher) ? w.watcher[0] : w.watcher;
    return { id: w.user_id, full_name: p?.full_name ?? "Unknown" };
  });
  const isParticipant = isSubmitter || watchers.some((w) => w.id === user!.id);
  const isApprover = roles.includes("approver");
  const isAccounts = roles.includes("accounts");

  // Only Accounts can deduct TDS, so only Accounts needs the list.
  const { data: tdsSectionRows } = isAccounts
    ? await supabase
        .from("tds_sections")
        .select("id, code, name, rate")
        .eq("is_active", true)
        .order("code")
    : { data: [] };
  const tdsSections = (tdsSectionRows ?? []) as {
    id: string;
    code: string;
    name: string;
    rate: number | null;
  }[];
  const isAdmin = roles.includes("admin");

  const lineItems = (lineRes.data ?? []) as unknown as LineItemRow[];
  const installments = ((instRes.data ?? []) as unknown as InstallmentRow[]).map((i) => ({
    ...i,
    // Every payment against this instalment, newest first. There can be more
    // than one: an instalment settled in parts has a row per payment.
    payments: (Array.isArray(i.payment_record)
      ? i.payment_record
      : i.payment_record
        ? [i.payment_record]
        : []
    ).sort((a, b) => String(b.payment_date ?? "").localeCompare(String(a.payment_date ?? ""))),
    payment_record: Array.isArray(i.payment_record) ? (i.payment_record[0] ?? null) : i.payment_record,
  }));

  const poValue = lineItems.reduce((s, l) => s + Number(l.amount), 0);
  // SUM, not the first row. Taking one record would under-report an
  // instalment that was settled in parts.
  const paidTotal = installments.reduce(
    (s, i) => s + i.payments.reduce((n, p) => n + Number(p.paid_amount ?? 0), 0),
    0,
  );
  const requestedTotal = installments
    .filter((i) => !["cancelled", "rejected", "draft"].includes(i.status))
    .reduce((s, i) => s + Number(i.requested_amount), 0);
  // Two different "balances": what's left to PAY (header chip — the money
  // question) vs what's left to REQUEST (gates the raise-installment panel).
  const balanceRemaining = Math.max(0, Math.round((poValue - requestedTotal) * 100) / 100);
  const yetToPay = Math.max(0, Math.round((poValue - paidTotal) * 100) / 100);
  // Null rather than 0 when there is no PO value: "0% of nothing" is noise,
  // and dividing by it is worse.
  const pct = (n: number) => (poValue > 0 ? (n / poValue) * 100 : null);

  // Each instalment's share of the PO, and the running total up to and
  // including it — so a milestone plan ("Stage 02, 30% of PO value") can be
  // checked against what was actually raised.
  //
  // Counts the same instalments requestedTotal does: a cancelled or rejected
  // one is not part of the plan any more, and letting it push the running
  // total along would make the last one read as more of the PO than was ever
  // asked for.
  const cumulativeById = new Map<string, number>();
  {
    let running = 0;
    for (const i of [...installments].sort((a, b) => a.installment_number - b.installment_number)) {
      if (["cancelled", "rejected", "draft"].includes(i.status)) continue;
      running += Number(i.requested_amount);
      cumulativeById.set(i.id, running);
    }
  }

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

  // Comment attachments arrive nested in the comments select (attachments has
  // a single FK to comments) — no second serialized query needed.
  type RawComment = {
    id: string;
    body: string;
    created_at: string;
    author_id: string;
    author: { full_name: string; email: string } | null;
    mentions: { mentioned: { full_name: string } | null }[];
    attachments: {
      id: string;
      storage_path: string;
      file_name: string;
      file_size_bytes: number;
      mime_type: string | null;
    }[];
  };
  const rawComments = (commentRes.data ?? []) as unknown as RawComment[];

  const allPaths = [
    ...rawAttachments.map((a) => a.storage_path),
    ...rawComments.flatMap((c) => (c.attachments ?? []).map((a) => a.storage_path)),
  ];
  const urlByPath = new Map<string, string>();
  await Promise.all(
    allPaths.map(async (path) => {
      const { data: signed } = await admin.storage.from("request-attachments").createSignedUrl(path, 3600);
      if (signed?.signedUrl) urlByPath.set(path, signed.signedUrl);
    }),
  );

  const requestStageAtt = rawAttachments.filter((a) => a.stage === "request");

  // Invoices and payment proofs were stored and then shown nowhere. Uploading
  // one gave a success message and no sign of the file, so people uploaded it
  // again — there are already two copies of the same invoice on one
  // instalment because of it.
  //
  // The link is the storage path: {requestId}/installments/{id}/invoice/...
  // There is no installment_id column on attachments, so the path is what
  // there is to match on.
  const attByInstallment = new Map<string, typeof rawAttachments>();
  for (const a of rawAttachments) {
    if (a.stage !== "invoice" && a.stage !== "payment") continue;
    const m = /\/installments\/([0-9a-f-]{36})\//.exec(a.storage_path);
    if (!m) continue;
    const list = attByInstallment.get(m[1]) ?? [];
    list.push(a);
    attByInstallment.set(m[1], list);
  }

  const comments: CommentItem[] = rawComments.map((c) => ({
    id: c.id,
    body: c.body,
    created_at: c.created_at,
    author_id: c.author_id,
    author_name: c.author?.full_name ?? "—",
    author_email: c.author?.email ?? "",
    is_me: c.author_id === user!.id,
    mentioned_names: (c.mentions ?? []).map((m) => m.mentioned?.full_name ?? "").filter(Boolean),
    attachments: (c.attachments ?? []).map((a): ThreadAttachment => ({
      id: a.id,
      file_name: a.file_name,
      file_size_bytes: a.file_size_bytes,
      mime_type: a.mime_type,
      url: urlByPath.get(a.storage_path) ?? null,
    })),
  }));

  const mentionCandidates = ((mentionCandRes.data ?? []) as {
    id: string;
    full_name: string;
    email: string;
  }[]).filter((p) => p.id !== user!.id);

  // Thread status = the most action-relevant installment status, not simply
  // the latest. A fully-paid thread with one rejected re-attempt should read
  // as paid, not "Rejected".
  const threadStatus = deriveThreadStatus(installments.map((i) => i.status));

  // The PO can only be rewritten while no installment has been approved —
  // an approver's sign-off must not shift underneath them.
  const PO_LOCKED = ["approved", "uploaded_in_bank", "invoice_pending", "payment_processed", "closed"];
  const canEditPo =
    (isParticipant || isAdmin) && !installments.some((i) => PO_LOCKED.includes(i.status));

  // Whether the submitter can raise another installment.
  const canRaiseInstallment = isParticipant && balanceRemaining > 0.005;

  return (
    <div>
      <MarkRead requestId={req.id} />
      <div className="mb-4 text-sm">
        <Link href={isParticipant ? "/requests" : "/approvals"} className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
          ← Back
        </Link>
      </div>

      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="min-w-0">
          <p className="font-mono text-xs text-zinc-500">{shortRequestNumber(req.request_number)}</p>
          <h1 className="mt-1 text-xl font-semibold text-zinc-900 sm:text-2xl dark:text-zinc-50">
            {req.title || req.vendor?.name}
          </h1>
          {req.title && (
            <p className="mt-0.5 text-sm text-zinc-500">{req.vendor?.name}</p>
          )}
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
            {req.payment_kind && (
              <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700 dark:bg-violet-950 dark:text-violet-200">
                {req.payment_kind === "milestone" ? "Milestone" : "Regular"}
              </span>
            )}
          </div>
          <p className="mt-2 text-xs text-zinc-500 sm:text-sm">
            Raised by {req.submitter?.full_name} · {formatISTDate(req.created_at)}
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
        <div className="sm:text-right">
          {/* 2x2 on a phone. Four chips in a three-column grid leaves the last
              one stranded on its own row. */}
          <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-col sm:items-end">
            <MoneyChip label="PO value" value={poValue} />
            {/* Raised is the question the other two do not answer: how much of
                the PO has even been asked for yet. On a milestone job that is
                usually the number people actually want. */}
            <MoneyChip label="Raised" value={requestedTotal} percent={pct(requestedTotal)} />
            <MoneyChip label="Paid" value={paidTotal} tone="emerald" percent={pct(paidTotal)} />
            <MoneyChip
              label="Yet to pay"
              value={yetToPay}
              tone={yetToPay > 0 ? "amber" : "zinc"}
              percent={pct(yetToPay)}
            />
          </div>
          {isAdmin && (
            <div className="mt-3">
              <DeleteRequest
                requestId={req.id}
                requestNumber={shortRequestNumber(req.request_number)}
                installmentCount={installments.length}
                paidTotal={paidTotal}
              />
            </div>
          )}
        </div>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          {/* Line items = PO breakdown */}
          <Card
            title={`Line items (${lineItems.length})`}
            action={
              canEditPo ? (
                <EditLineItems
                  requestId={req.id}
                  coaAccounts={(coaRes.data ?? []) as { id: string; subcategory: string; category: string; coa: string }[]}
                  initial={lineItems.map((l) => ({
                    coaAccountId: l.coa_account?.id ?? "",
                    quantity: Number(l.quantity),
                    rate: Number(l.rate),
                  }))}
                  minPoValue={requestedTotal}
                />
              ) : undefined
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left text-[11px] uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
                    <th className="px-2 py-2 font-medium">{COA_LABEL.level2} / {COA_LABEL.level3}</th>
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
                          {l.coa_account && l.coa_account.subcategory === l.coa_account.category && (
                            <span className="ml-1.5 rounded-full bg-indigo-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300">
                              Whole category
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-zinc-500">
                          {l.coa_account && l.coa_account.subcategory === l.coa_account.category
                            ? l.coa_account.coa
                            : `${l.coa_account?.category} · ${l.coa_account?.coa}`}
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
                      {pct(Number(inst.requested_amount)) != null && cumulativeById.has(inst.id) && (
                        <p className="mt-0.5 text-xs text-zinc-500 tabular-nums">
                          {Math.round(pct(Number(inst.requested_amount))!)}% of PO
                          <span className="mx-1.5 text-zinc-300 dark:text-zinc-600">·</span>
                          {Math.round(pct(cumulativeById.get(inst.id)!)!)}% cumulative
                        </p>
                      )}
                      {Number(inst.tds_amount ?? 0) > 0 && (
                        <p className="mt-0.5 text-xs text-zinc-500">
                          less TDS {formatINR(Number(inst.tds_amount))}
                          {inst.tds_section ? ` (${inst.tds_section})` : ""} · vendor gets{" "}
                          <span className="font-medium text-zinc-700 dark:text-zinc-300">
                            {formatINR(Number(inst.requested_amount) - Number(inst.tds_amount))}
                          </span>
                        </p>
                      )}
                    </div>
                    <StatusPill status={inst.status} />
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1 text-xs text-zinc-600 sm:grid-cols-2 dark:text-zinc-400">
                    <p>Due {formatDateOnly(inst.payment_due_date)}</p>
                    <p>Raised by {inst.submitter?.full_name ?? "—"} · {formatISTDate(inst.submitted_at)}</p>
                    {inst.date_of_work_completion && <p>Work completed {formatDateOnly(inst.date_of_work_completion)}</p>}
                    {inst.tentative_invoice_date && <p>Tentative invoice {formatDateOnly(inst.tentative_invoice_date)}</p>}
                    {inst.approved_at && inst.approver && (
                      <p>Approved by {inst.approver.full_name} · {formatISTDate(inst.approved_at)}</p>
                    )}
                  </div>
                  {inst.purpose && (
                    <p className="mt-2 rounded-md bg-zinc-50 p-2 text-xs text-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300">
                      Note: {inst.purpose}
                    </p>
                  )}
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
                  {/* Every payment, not just one. An instalment settled in
                      parts has a row each, and showing only the first hid a
                      real UTR for money that had already gone. */}
                  {inst.payments.filter((p) => p.payment_date).length > 0 && (() => {
                    const paid = inst.payments.filter((p) => p.payment_date);
                    const paidSum = paid.reduce((n, p) => n + Number(p.paid_amount ?? 0), 0);
                    const owing = Math.max(0, Number(inst.requested_amount) - paidSum);
                    return (
                      <div className="mt-3 rounded-md bg-emerald-50 p-3 text-xs dark:bg-emerald-950/40">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                            {paid.length === 1 ? "Payment" : `Payments (${paid.length})`}
                          </p>
                          {paid.length > 1 && (
                            <p className="font-mono text-xs font-semibold tabular-nums text-emerald-900 dark:text-emerald-100">
                              {formatINR(paidSum)}
                            </p>
                          )}
                        </div>
                        <ul className="mt-1 space-y-2">
                          {paid.map((p, n) => (
                            <li
                              key={`${p.utr_reference ?? n}`}
                              className={n > 0 ? "border-t border-emerald-100 pt-2 dark:border-emerald-900" : ""}
                            >
                              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-emerald-900 dark:text-emerald-100">
                                <p>Paid on {p.payment_date}</p>
                                {p.paid_amount != null && (
                                  <p className="font-mono tabular-nums">{formatINR(p.paid_amount)}</p>
                                )}
                                {p.utr_reference && <p className="col-span-2 font-mono">UTR: {p.utr_reference}</p>}
                                {p.payment_mode && (
                                  <p>Mode: {PAYMENT_MODE_LABEL[p.payment_mode] ?? p.payment_mode}</p>
                                )}
                                {p.paying_bank_account && <p>Paid from: {p.paying_bank_account}</p>}
                              </div>
                              {/* Admin only, NOT Accounts. Accounts record
                                  payments; admin corrects them — the person who
                                  entered a figure should not be able to rewrite
                                  it alone. Re-checked in the action, because
                                  hiding a button is not a permission. */}
                              {isAdmin && p.id && p.payment_date && (
                                <EditPayment
                                  paymentId={p.id}
                                  paymentDate={p.payment_date}
                                  paidAmount={Number(p.paid_amount ?? 0)}
                                  utr={p.utr_reference ?? ""}
                                  payingBank={p.paying_bank_account ?? null}
                                />
                              )}
                            </li>
                          ))}
                        </ul>
                        {owing > 0.5 && (
                          /* Stated plainly. A part-paid instalment that looks
                             settled is how a balance gets forgotten. */
                          <p className="mt-2 rounded bg-amber-100 px-2 py-1 font-medium text-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
                            {formatINR(owing)} still to pay on this installment.
                          </p>
                        )}
                      </div>
                    );
                  })()}

                  {(attByInstallment.get(inst.id) ?? []).length > 0 && (
                    <div className="mt-3">
                      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                        Invoice &amp; payment proof
                      </p>
                      <AttachmentsGrid
                        items={attByInstallment.get(inst.id) ?? []}
                        urlByPath={urlByPath}
                        canDelete={isAccounts || isAdmin}
                        requestId={req.id}
                      />
                    </div>
                  )}

                  <div className="mt-3">
                    <InstallmentActions
                      installmentId={inst.id}
                      requestId={req.id}
                      status={inst.status}
                      vendorStatus={req.vendor?.status ?? "approved"}
                      amountOutstanding={Math.max(
                        0,
                        Number(inst.requested_amount) -
                          inst.payments.reduce((n, p) => n + Number(p.paid_amount ?? 0), 0),
                      )}
                      vendorId={req.vendor_id}
                      isSubmitter={isParticipant}
                      isApprover={isApprover}
                      isAccounts={isAccounts}
                      isAdmin={isAdmin}
                      requestedAmount={Number(inst.requested_amount)}
                      tdsAmount={Number(inst.tds_amount ?? 0)}
                      tdsSection={inst.tds_section}
                      tdsSectionId={inst.tds_section_id}
                      tdsSections={tdsSections}
                      queuedForUpload={!!inst.queued_for_upload_at}
                      paymentDueDate={inst.payment_due_date}
                      dateOfWorkCompletion={inst.date_of_work_completion}
                      tentativeInvoiceDate={inst.tentative_invoice_date}
                      needsTentativeInvoice={
                        req.document_type === "po" || req.document_type === "invoice_pending"
                      }
                      note={inst.purpose}
                      maxAmount={Math.max(
                        0,
                        Math.round(
                          (poValue -
                            installments
                              .filter(
                                (o) =>
                                  o.id !== inst.id &&
                                  !["cancelled", "rejected", "draft"].includes(o.status),
                              )
                              .reduce((s, o) => s + Number(o.requested_amount), 0)) * 100,
                        ) / 100,
                      )}
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
                tentativeInvoiceDate={
                  installments.find((i) => i.tentative_invoice_date)?.tentative_invoice_date ?? null
                }
                needsTentativeInvoice={
                  req.document_type === "po" || req.document_type === "invoice_pending"
                }
                />
              </div>
            )}
            {!canRaiseInstallment && balanceRemaining <= 0.005 && (
              <p className="mt-4 text-center text-xs text-zinc-500">
                Full PO value has been requested — nothing left to raise. Remaining payments are with approval/accounts.
              </p>
            )}
          </Card>

          {/* Attachments — Request stage */}
          {requestStageAtt.length > 0 && (
            <Card title={`Supporting documents (${requestStageAtt.length})`}>
              <AttachmentsGrid
                items={requestStageAtt}
                urlByPath={urlByPath}
                canDelete={isParticipant || isAdmin}
                requestId={req.id}
              />
            </Card>
          )}

          {/* Discussion */}
          <DiscussionThread requestId={req.id} comments={comments} candidates={mentionCandidates} />

          <Card title="CC">
            <CcPanel
              requestId={req.id}
              watchers={watchers}
              candidates={mentionCandidates
                .filter((c) => c.id !== req.submitter_id)
                .map((c) => ({ id: c.id, full_name: c.full_name }))}
              /* Not "anyone who can see it": a CC is read access, and letting a
                 recipient pass it on means access spreads with nobody able to
                 say who granted it. Enforced again server-side. */
              canEdit={isSubmitter || isApprover || isAccounts || isAdmin}
            />
          </Card>
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
                    {h.actor?.full_name ?? "—"} · {formatISTDateTime(h.created_at)}
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

    </div>
  );
}

/**
 * Pick the most action-relevant status to summarize a thread:
 * anything awaiting someone's action wins; then in-flight payment states;
 * then terminal states. Rejected/cancelled only shows when nothing else
 * ever succeeded.
 */
function deriveThreadStatus(statuses: string[]): string {
  if (statuses.length === 0) return "draft";
  const priority = [
    "clarification_required",
    "pending_approval",
    "returned_for_correction",
    "approved",
    "uploaded_in_bank",
    "invoice_pending",
    "payment_processed",
    "closed",
    "rejected",
    "cancelled",
    // Last: a recalled draft shouldn't mask a paid or pending sibling.
    "draft",
  ];
  for (const s of priority) {
    if (statuses.includes(s)) return s;
  }
  return statuses[statuses.length - 1];
}

function Card({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{title}</h2>
        {action}
      </div>
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

function MoneyChip({
  label,
  value,
  tone = "zinc",
  percent,
}: {
  label: string;
  value: number;
  tone?: "emerald" | "amber" | "zinc";
  /** Share of the PO value, 0-100. Omitted where a percentage is meaningless. */
  percent?: number | null;
}) {
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
      {percent != null && (
        /* Rounded to whole numbers: a decimal place on a share invites people
           to reconcile it against the rupees, which it will not survive. */
        <p className="text-[10px] tabular-nums opacity-70">{Math.round(percent)}% of PO</p>
      )}
    </div>
  );
}

function AttachmentsGrid({
  items,
  urlByPath,
  canDelete = false,
  requestId,
}: {
  items: { id: string; storage_path: string; file_name: string; file_size_bytes: number; mime_type: string | null }[];
  urlByPath: Map<string, string>;
  canDelete?: boolean;
  requestId?: string;
}) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {items.map((a) => {
        const url = urlByPath.get(a.storage_path);
        const isImage = (a.mime_type ?? "").startsWith("image/");
        return (
          <li key={a.id} className="relative overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-800">
            {canDelete && requestId && (
              <form action={deleteAttachment} className="absolute right-1 top-1 z-10">
                <input type="hidden" name="attachment_id" value={a.id} />
                <input type="hidden" name="request_id" value={requestId} />
                <button
                  type="submit"
                  aria-label={`Delete ${a.file_name}`}
                  title="Delete document"
                  className="flex h-6 w-6 items-center justify-center rounded-full bg-black/50 text-xs text-white hover:bg-red-600"
                >
                  ✕
                </button>
              </form>
            )}
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
