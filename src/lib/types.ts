// Placeholder for eventual generated types via `supabase gen types`.
// For now we type queries inline and let Supabase's client infer where possible.
export type Database = unknown;

export const ROLE_LABEL: Record<string, string> = {
  requester: "Requester",
  approver: "Approver",
  accounts: "Accounts",
  admin: "Admin",
};

export const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  pending_approval: "Pending approval",
  clarification_required: "Clarification required",
  approved: "Approved",
  uploaded_in_bank: "Uploaded in bank",
  payment_processed: "Payment processed",
  invoice_pending: "Invoice pending",
  closed: "Closed",
  returned_for_correction: "Returned for correction",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

export function formatINR(n: number | string | null | undefined): string {
  if (n === null || n === undefined) return "—";
  const num = typeof n === "string" ? Number(n) : n;
  if (Number.isNaN(num)) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(num);
}

/** "PR-2026-00134" → "PR-00134". Stored numbers keep the year (unique,
 *  sortable); the year is just noise on screen. */
export function shortRequestNumber(rn: string | null | undefined): string {
  return (rn ?? "").replace(/^PR-\d{4}-/, "PR-");
}

// Timestamps are stored in UTC and the server renders in UTC (Vercel), so
// every display must pin IST explicitly or dates shift by up to a day.
const IST_TZ = "Asia/Kolkata";

/** "24 Jul 2026" in IST. */
export function formatISTDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    timeZone: IST_TZ,
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * A plain calendar date (a DATE column like a due date), formatted "24 Jul
 * 2026". No timezone maths — these carry no time, so shifting them would be
 * wrong.
 */
export function formatDateOnly(value: string | null | undefined): string {
  if (!value) return "—";
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return value;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-IN", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** "24 Jul 2026, 3:41 pm" in IST. */
export function formatISTDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: IST_TZ,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/**
 * What still has to leave the bank on an instalment.
 *
 * TDS is withheld, not owed. On a ₹1,18,000 instalment with ₹10,000 of TDS,
 * ₹1,08,000 reaches the vendor and the ₹10,000 goes to the government — the
 * instalment is settled, and nothing is pending. Subtracting only the payments
 * left the TDS sitting there as a permanent unpaid balance, which kept the
 * instalment out of "paid" and in the Accounts queue for ever.
 *
 * Every caller goes through here so the detail page, the action that records a
 * payment, and the buttons can never disagree about whether money is still
 * owed.
 */
export function amountStillToPay(
  requestedAmount: number | string | null | undefined,
  tdsAmount: number | string | null | undefined,
  paidSoFar: number,
): number {
  const net = Number(requestedAmount ?? 0) - Number(tdsAmount ?? 0);
  return Math.max(0, net - paidSoFar);
}


/**
 * The one status a whole request shows, out of its installments'.
 *
 * Lives here rather than on the detail page because the spend report groups by
 * it too, and two versions of "what status is this request" would sooner or
 * later disagree with the badge on the request itself.
 */
export function deriveThreadStatus(statuses: string[]): string {
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

/**
 * The pipeline stages Accounts actually works, in the order they happen.
 *
 * Two of them are not statuses at all. "Approved" and "To upload" share the
 * status `approved` — what separates them is whether the installment has been
 * queued into the next bank file. And "Paid · invoice due" and "Paid · to
 * close" both mean the money has LEFT THE BANK; only the vendor's invoice
 * differs. So the bucket cannot be read off `status` alone, which is why this
 * lives in one place instead of being re-derived per screen.
 */
export type PipelineBucket =
  | "pending" | "approved" | "to_upload" | "in_bank"
  | "invoice_pending" | "paid" | "closed";

export const PIPELINE_ORDER: PipelineBucket[] = [
  "pending", "approved", "to_upload", "in_bank", "invoice_pending", "paid", "closed",
];

export const PIPELINE_LABEL: Record<PipelineBucket, string> = {
  pending: "Pending for approval",
  approved: "Approved",
  to_upload: "To upload",
  in_bank: "In bank",
  invoice_pending: "Paid · invoice due",
  paid: "Paid · to close",
  closed: "Closed",
};

/** Null for anything not in the pipeline — rejected, cancelled, draft. */
export function pipelineBucket(
  status: string,
  queuedForUploadAt: string | null | undefined,
): PipelineBucket | null {
  switch (status) {
    case "pending_approval":
    case "clarification_required":
      return "pending";
    case "approved":
      return queuedForUploadAt ? "to_upload" : "approved";
    case "uploaded_in_bank":
      return "in_bank";
    case "invoice_pending":
      return "invoice_pending";
    case "payment_processed":
      return "paid";
    case "closed":
      return "closed";
    default:
      return null;
  }
}

/**
 * One bucket for a whole request, out of its installments'.
 *
 * Takes the EARLIEST stage present, the same way deriveThreadStatus does: a
 * request with one installment paid and another still awaiting approval has
 * not finished, and saying "Closed" because its last installment closed would
 * hide the one still needing a decision.
 */
export function threadPipelineBucket(
  installments: { status: string; queued_for_upload_at?: string | null }[],
): PipelineBucket | null {
  const present = new Set(
    installments
      .map((i) => pipelineBucket(i.status, i.queued_for_upload_at ?? null))
      .filter((b): b is PipelineBucket => b !== null),
  );
  return PIPELINE_ORDER.find((b) => present.has(b)) ?? null;
}
