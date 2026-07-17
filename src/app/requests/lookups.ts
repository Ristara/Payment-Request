"use server";

import { createClient } from "@/lib/supabase/server";

/**
 * Sum of paid_amount across payment_records tied to PAID installments in
 * a given thread. Powers the "Previous paid" hint on the raise-installment
 * form — Previous Paid on installment N is the total already released
 * on installments 1..N-1 in this same thread.
 */
export async function getPreviousPaidForThread(
  requestId: string,
): Promise<{ totalPaid: number; installmentCount: number }> {
  if (!requestId) return { totalPaid: 0, installmentCount: 0 };
  const supabase = await createClient();
  const { data } = await supabase
    .from("request_installments")
    .select("id, status, payment_records(paid_amount)")
    .eq("request_id", requestId)
    .in("status", ["uploaded_in_bank", "payment_processed", "invoice_pending", "closed"]);

  type Row = { id: string; status: string; payment_records: { paid_amount: number | null }[] | { paid_amount: number | null } | null };
  const rows = (data ?? []) as unknown as Row[];
  let totalPaid = 0;
  let installmentCount = 0;
  for (const r of rows) {
    const rec = Array.isArray(r.payment_records) ? r.payment_records[0] : r.payment_records;
    const amt = rec?.paid_amount ? Number(rec.paid_amount) : 0;
    if (amt > 0) {
      totalPaid += amt;
      installmentCount += 1;
    }
  }
  return { totalPaid: Math.round(totalPaid * 100) / 100, installmentCount };
}

/**
 * Legacy helper — kept as a thin wrapper for now. Previous Paid on the
 * first-time raise form is always ₹0 (no prior installments in a
 * brand-new thread), so this returns 0.
 */
export async function getPreviousPaid(
  _vendorId: string,
  _documentReference: string | null,
): Promise<{ totalPaid: number; requestCount: number }> {
  return { totalPaid: 0, requestCount: 0 };
}
