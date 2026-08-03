import "server-only";
import { createClient } from "@/lib/supabase/server";
import { shortRequestNumber } from "@/lib/types";
import { COA_LABEL } from "@/lib/coa-labels";

/**
 * Ria's data tools — the eight things she can look up.
 *
 * Shared by two callers now: the text chat route, and the voice path, where
 * Gemini talks straight to the browser and the browser posts tool calls back
 * here. Both run them through the USER'S Supabase client, so RLS scopes the
 * answers exactly as the app does — a requester's Ria cannot see another
 * person's requests, whichever way they asked.
 */
export type Supa = Awaited<ReturnType<typeof createClient>>;

export const TOOL_DECLARATIONS = [
  {
    name: "list_my_requests",
    description:
      "List recent payment request threads visible to the current user (their own + CC'd for submitters; all for approvers/accounts). Returns number, title, vendor, PO value and installment statuses.",
  },
  {
    name: "list_pending_approvals",
    description:
      "List installments currently waiting for approval (pending approval or clarification required).",
  },
  {
    name: "get_request",
    description:
      "Get full details of one payment request by its number, e.g. 'PR-00134', '00134' or 'PR-2026-00134'. Includes title, vendor, PO value, installments with statuses and payments.",
    parameters: {
      type: "OBJECT",
      properties: {
        number: { type: "STRING", description: "The request number in any format" },
      },
      required: ["number"],
    },
  },
  {
    name: "vendor_payments",
    description:
      "Total paid and recent payment records for a vendor (searched by partial name).",
    parameters: {
      type: "OBJECT",
      properties: {
        vendor_name: { type: "STRING", description: "Partial or full vendor name" },
      },
      required: ["vendor_name"],
    },
  },
  {
    name: "list_overdue",
    description:
      "List unpaid installments whose payment due date has already passed.",
  },
  {
    name: "list_ready_to_pay",
    description:
      "Approved installments waiting to go to the bank, split into those the Kotak bank file can take and those held back because the vendor isn't approved or has no account number / IFSC.",
  },
  {
    name: "vendor_status",
    description:
      "Look up a vendor by partial name: approval status, whether bank details and mobile number are on file, and what is missing. Use this to answer why a payment can't be approved or paid.",
    parameters: {
      type: "OBJECT",
      properties: { vendor_name: { type: "STRING", description: "Partial or full vendor name" } },
      required: ["vendor_name"],
    },
  },
  {
    name: "spend_by_category",
    description:
      "Total spend grouped by chart-of-accounts category, counting only requests with at least one approved-or-later installment.",
  },
];

// ------ Tool implementations (all through the user's RLS-scoped client) ------


async function listMyRequests(supabase: Supa) {
  const { data, error } = await supabase
    .from("payment_requests")
    .select(
      `request_number, title, created_at, vendor:vendors(name),
       line_items:request_line_items(amount),
       installments:request_installments(installment_number, status, requested_amount, payment_due_date)`,
    )
    .order("created_at", { ascending: false })
    .limit(25);
  if (error) return { error: error.message };
  return {
    requests: (data ?? []).map((r) => {
      const row = r as unknown as {
        request_number: string; title: string | null; created_at: string;
        vendor: { name: string } | null;
        line_items: { amount: number }[];
        installments: { installment_number: number; status: string; requested_amount: number; payment_due_date: string }[];
      };
      return {
        number: shortRequestNumber(row.request_number),
        title: row.title,
        vendor: row.vendor?.name,
        po_value: row.line_items.reduce((s, l) => s + Number(l.amount), 0),
        installments: row.installments.map((i) => ({
          n: i.installment_number, status: i.status,
          amount: Number(i.requested_amount), due: i.payment_due_date,
        })),
      };
    }),
  };
}

async function listPendingApprovals(supabase: Supa) {
  const { data, error } = await supabase
    .from("request_installments")
    .select(
      `installment_number, requested_amount, submitted_at, status,
       request:payment_requests!inner(request_number, title, vendor:vendors(name),
         submitter:profiles!payment_requests_submitter_id_fkey(full_name))`,
    )
    .in("status", ["pending_approval", "clarification_required"])
    .order("submitted_at", { ascending: false })
    .limit(25);
  if (error) return { error: error.message };
  return {
    pending: (data ?? []).map((r) => {
      const row = r as unknown as {
        installment_number: number; requested_amount: number; submitted_at: string; status: string;
        request: {
          request_number: string; title: string | null; vendor: { name: string } | null;
          submitter: { full_name: string } | null;
        };
      };
      return {
        number: shortRequestNumber(row.request.request_number),
        installment: row.installment_number,
        title: row.request.title,
        vendor: row.request.vendor?.name,
        raised_by: row.request.submitter?.full_name ?? null,
        amount: Number(row.requested_amount),
        status: row.status,
        submitted_at: row.submitted_at,
      };
    }),
  };
}

async function getRequest(supabase: Supa, numberRaw: string) {
  // Keep only digits, drop a leading year, and zero-pad to the 5-digit
  // sequence — "PR-00134", "134", "PR-2026-00134" all resolve exactly, and
  // no LIKE wildcards from the input can reach the query.
  let digits = String(numberRaw).replace(/^\s*pr[-\s]*/i, "").replace(/^\d{4}-/, "").replace(/\D/g, "");
  if (digits.length > 5) digits = digits.slice(-5);
  if (!digits) return { error: "No request number given." };
  const padded = digits.padStart(5, "0");
  const { data, error } = await supabase
    .from("payment_requests")
    .select(
      `request_number, title, purpose, created_at, payment_kind,
       vendor:vendors(name, status),
       submitter:profiles!payment_requests_submitter_id_fkey(full_name),
       line_items:request_line_items(amount, coa_account:coa_accounts(subcategory, category)),
       installments:request_installments(installment_number, status, requested_amount, payment_due_date,
         payment_record:payment_records(paid_amount, payment_date, utr_reference))`,
    )
    .like("request_number", `%-${padded}`)
    .limit(1)
    .maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: `No request found matching "${numberRaw}" (or you don't have access to it).` };
  const row = data as unknown as {
    request_number: string; title: string | null; purpose: string; created_at: string; payment_kind: string | null;
    vendor: { name: string; status: string } | null;
    submitter: { full_name: string } | null;
    line_items: { amount: number; coa_account: { subcategory: string; category: string } | null }[];
    installments: {
      installment_number: number; status: string; requested_amount: number; payment_due_date: string;
      payment_record: { paid_amount: number | null; payment_date: string | null; utr_reference: string | null }[] | { paid_amount: number | null; payment_date: string | null; utr_reference: string | null } | null;
    }[];
  };
  return {
    number: shortRequestNumber(row.request_number),
    title: row.title,
    purpose: row.purpose,
    vendor: row.vendor?.name,
    // Ria was asked "who raised this?" and had no way to answer: the submitter
    // was never selected by any of these tools.
    raised_by: row.submitter?.full_name ?? null,
    payment_kind: row.payment_kind,
    po_value: row.line_items.reduce((s, l) => s + Number(l.amount), 0),
    lines: row.line_items.map((l) => ({
      amount: Number(l.amount),
      subcategory: l.coa_account?.subcategory,
      category: l.coa_account?.category,
    })),
    installments: row.installments.map((i) => {
      const pr = Array.isArray(i.payment_record) ? i.payment_record[0] : i.payment_record;
      return {
        n: i.installment_number, status: i.status, amount: Number(i.requested_amount),
        due: i.payment_due_date,
        paid: pr?.paid_amount ? Number(pr.paid_amount) : null,
        paid_on: pr?.payment_date ?? null,
        utr: pr?.utr_reference ?? null,
      };
    }),
  };
}

async function vendorPayments(supabase: Supa, vendorName: string) {
  const name = String(vendorName).trim();
  if (!name) return { error: "No vendor name given." };
  const safeName = name.replace(/[%_\\]/g, " ").trim();
  const { data: vendors, error: vErr } = await supabase
    .from("vendors")
    .select("id, name")
    .ilike("name", `%${safeName}%`)
    .limit(5);
  if (vErr) return { error: vErr.message };
  if (!vendors?.length) return { error: `No vendor matching "${name}".` };

  const results = [];
  for (const v of vendors) {
    const { data: threads } = await supabase
      .from("payment_requests")
      .select(
        `request_number, title,
         installments:request_installments(status, requested_amount,
           payment_record:payment_records(paid_amount, payment_date))`,
      )
      .eq("vendor_id", v.id)
      .limit(50);
    const truncated = (threads?.length ?? 0) === 50;
    let paidTotal = 0;
    const payments: { number: string; amount: number; date: string | null }[] = [];
    for (const t of (threads ?? []) as unknown as {
      request_number: string;
      installments: { payment_record: { paid_amount: number | null; payment_date: string | null }[] | { paid_amount: number | null; payment_date: string | null } | null }[];
    }[]) {
      for (const i of t.installments) {
        const pr = Array.isArray(i.payment_record) ? i.payment_record[0] : i.payment_record;
        if (pr?.paid_amount) {
          paidTotal += Number(pr.paid_amount);
          payments.push({
            number: shortRequestNumber(t.request_number),
            amount: Number(pr.paid_amount),
            date: pr.payment_date,
          });
        }
      }
    }
    results.push({
      vendor: v.name,
      total_paid: paidTotal,
      total_is_partial: truncated,
      payments: payments.slice(0, 15),
    });
  }
  return { vendors: results };
}

async function listOverdue(supabase: Supa) {
  const todayIST = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("request_installments")
    .select(
      `installment_number, requested_amount, payment_due_date, status,
       request:payment_requests!inner(request_number, title, vendor:vendors(name),
         submitter:profiles!payment_requests_submitter_id_fkey(full_name))`,
    )
    .lt("payment_due_date", todayIST)
    .in("status", ["pending_approval", "clarification_required", "approved", "uploaded_in_bank"])
    .order("payment_due_date")
    .limit(30);
  if (error) return { error: error.message };
  return {
    today: todayIST,
    overdue: (data ?? []).map((r) => {
      const row = r as unknown as {
        installment_number: number; requested_amount: number; payment_due_date: string; status: string;
        request: {
          request_number: string; title: string | null; vendor: { name: string } | null;
          submitter: { full_name: string } | null;
        };
      };
      return {
        number: shortRequestNumber(row.request.request_number),
        installment: row.installment_number,
        title: row.request.title,
        vendor: row.request.vendor?.name,
        raised_by: row.request.submitter?.full_name ?? null,
        amount: Number(row.requested_amount),
        due: row.payment_due_date,
        status: row.status,
      };
    }),
  };
}

async function spendByCategory(supabase: Supa) {
  const { data, error } = await supabase
    .from("request_line_items")
    .select(
      `amount, coa_account:coa_accounts(category),
       request:payment_requests!inner(installments:request_installments(status))`,
    )
    .limit(500);
  if (error) return { error: error.message };
  const truncated = (data?.length ?? 0) === 500;
  const spendStatuses = new Set(["approved", "uploaded_in_bank", "invoice_pending", "payment_processed", "closed"]);
  const totals = new Map<string, number>();
  for (const r of (data ?? []) as unknown as {
    amount: number;
    coa_account: { category: string } | null;
    request: { installments: { status: string }[] };
  }[]) {
    if (!r.request.installments.some((i) => spendStatuses.has(i.status))) continue;
    const cat = r.coa_account?.category ?? "Uncategorised";
    totals.set(cat, (totals.get(cat) ?? 0) + Number(r.amount));
  }
  return {
    note: truncated
      ? "PARTIAL DATA — only the first 500 line items were counted; totals are incomplete and you must say so."
      : "PO value of requests with at least one approved-or-later installment, by category",
    totals_are_partial: truncated,
    categories: [...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([category, total]) => ({ category, total })),
  };
}

async function listReadyToPay(supabase: Supa) {
  const { data, error } = await supabase
    .from("request_installments")
    .select(
      `installment_number, requested_amount,
       request:payment_requests!inner(request_number, title,
         vendor:vendors(name, status, bank_account_number, bank_ifsc))`,
    )
    .eq("status", "approved")
    .limit(100);
  if (error) return { error: error.message };
  type R = {
    installment_number: number; requested_amount: number;
    request: { request_number: string; title: string | null;
      vendor: { name: string; status: string; bank_account_number: string | null; bank_ifsc: string | null } | null };
  };
  const payable = [], heldBack = [];
  for (const r of (data ?? []) as unknown as R[]) {
    const v = r.request.vendor;
    const row = {
      number: shortRequestNumber(r.request.request_number),
      installment: r.installment_number,
      title: r.request.title,
      vendor: v?.name,
      amount: Number(r.requested_amount),
    };
    const ok = v?.status === "approved" && !!v.bank_account_number && !!v.bank_ifsc;
    if (ok) payable.push(row);
    else {
      heldBack.push({
        ...row,
        reason:
          v?.status !== "approved"
            ? "vendor not approved yet"
            : "vendor has no account number / IFSC",
      });
    }
  }
  return {
    payable,
    payable_total: payable.reduce((s, r) => s + r.amount, 0),
    held_back: heldBack,
    note: "Only the payable rows go into the Kotak bank file.",
  };
}

async function vendorStatus(supabase: Supa, vendorName: string) {
  const name = String(vendorName).replace(/[%_\\]/g, " ").trim();
  if (!name) return { error: "No vendor name given." };
  const { data, error } = await supabase
    .from("vendors")
    .select("name, status, gstin, pan, phone, bank_account_number, bank_ifsc, rejection_reason")
    .ilike("name", `%${name}%`)
    .limit(5);
  if (error) return { error: error.message };
  if (!data?.length) return { error: `No vendor matching "${name}".` };
  return {
    vendors: data.map((v) => {
      const missing: string[] = [];
      if (!v.phone) missing.push("mobile number");
      if (!v.bank_account_number) missing.push("bank account number");
      if (!v.bank_ifsc) missing.push("IFSC");
      return {
        name: v.name,
        status: v.status,
        gstin: v.gstin,
        pan: v.pan,
        has_bank_details: !!(v.bank_account_number && v.bank_ifsc),
        has_mobile: !!v.phone,
        missing_to_approve: missing,
        rejection_reason: v.rejection_reason,
        can_be_paid: v.status === "approved" && !!v.bank_account_number && !!v.bank_ifsc,
      };
    }),
  };
}

export async function runTool(supabase: Supa, name: string, args: Record<string, unknown>) {
  try {
    switch (name) {
      case "list_my_requests": return await listMyRequests(supabase);
      case "list_pending_approvals": return await listPendingApprovals(supabase);
      case "get_request": return await getRequest(supabase, String(args.number ?? ""));
      case "vendor_payments": return await vendorPayments(supabase, String(args.vendor_name ?? ""));
      case "list_overdue": return await listOverdue(supabase);
      case "list_ready_to_pay": return await listReadyToPay(supabase);
      case "vendor_status": return await vendorStatus(supabase, String(args.vendor_name ?? ""));
      case "spend_by_category": return await spendByCategory(supabase);
      default: return { error: `Unknown tool ${name}` };
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Tool failed" };
  }
}
