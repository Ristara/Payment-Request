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
