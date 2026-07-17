"use server";

import { createClient } from "@/lib/supabase/server";

/**
 * Sum of paid_amount across payment_records tied to prior payment
 * requests for the same vendor + document_reference. Used to auto-fill
 * "Previous paid" on the Raise form when the user picks a PO or Invoice
 * that another request has already been paid against (partial payments).
 *
 * Returns 0 when we can't correlate — vendorId missing, or docRef missing
 * (No Invoice / Invoice yet to receive don't carry a stable identifier).
 */
export async function getPreviousPaid(
  vendorId: string,
  documentReference: string | null,
): Promise<{ totalPaid: number; requestCount: number }> {
  if (!vendorId || !documentReference) return { totalPaid: 0, requestCount: 0 };

  const supabase = await createClient();
  // Only count requests that were actually paid — draft/pending/etc. don't move money.
  const { data } = await supabase
    .from("payment_requests")
    .select("id, payment_records(paid_amount)")
    .eq("vendor_id", vendorId)
    .eq("document_reference", documentReference.trim())
    .in("status", ["uploaded_in_bank", "payment_processed", "invoice_pending", "closed"]);

  type Row = { id: string; payment_records: { paid_amount: number | null }[] | { paid_amount: number | null } | null };
  const rows = (data ?? []) as unknown as Row[];
  let totalPaid = 0;
  let requestCount = 0;
  for (const r of rows) {
    // payment_records is a 1:1 relation in this app (upsert on request_id).
    const rec = Array.isArray(r.payment_records) ? r.payment_records[0] : r.payment_records;
    const amt = rec?.paid_amount ? Number(rec.paid_amount) : 0;
    if (amt > 0) {
      totalPaid += amt;
      requestCount += 1;
    }
  }
  return { totalPaid: Math.round(totalPaid * 100) / 100, requestCount };
}
