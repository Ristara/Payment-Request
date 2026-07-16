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
