import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { randomUUID } from "node:crypto";
import {
  BANKS,
  batchReference,
  buildIciciFile,
  buildKotakFile,
  formatBankDate,
  type BankFileRow,
  type BankKey,
} from "@/lib/bank-file";

export const runtime = "nodejs";

/**
 * Bulk-payment file for the installments Accounts have queued.
 *
 * Kotak and ICICI want different formats — Kotak a 49-column BIFF8 .xls with
 * a sheet named "electronic", ICICI a 19-column .xlsx — so the caller picks
 * which, and each has its own debit account in the environment.
 *
 * Installments included are moved to "uploaded in bank" in the same request,
 * with a status_history entry naming the file — so if an upload fails, an
 * approver can see exactly which batch it belonged to and push it back.
 *
 * Installments whose vendor has no account number / IFSC are left behind and
 * reported, never silently dropped.
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return back(req, "signin");

  const { data: roleRows } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
  const roles = new Set(((roleRows ?? []) as { role: string }[]).map((r) => r.role));
  // Accounts only — being an admin doesn't mean you're the one who pays.
  if (!roles.has("accounts")) return back(req, "forbidden");

  const form = await req.formData().catch(() => null);
  const bankRaw = String(form?.get("bank") ?? "kotak");
  const bank: BankKey = bankRaw === "icici" ? "icici" : "kotak";
  const spec = BANKS[bank];

  const debitAccount = process.env[spec.envVar]?.trim();
  // Naming the missing variable saves a round of "which account?".
  if (!debitAccount) return back(req, `noaccount-${bank}`);

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("request_installments")
    .select(
      `id, installment_number, requested_amount, tds_amount, status,
       request:payment_requests!inner(
         request_number, title,
         vendor:vendors(name, status, bank_account_number, bank_ifsc),
         outlets:request_outlets(outlet:outlets(name))
       )`,
    )
    .eq("status", "approved")
    // Only what Accounts have queued (migration 027). The file used to sweep
    // up everything approved, which left nobody deciding what actually left
    // the bank on a given run.
    .not("queued_for_upload_at", "is", null)
    .order("installment_number");
  if (error) return back(req, "failed");

  type Row = {
    id: string;
    installment_number: number;
    requested_amount: number;
    tds_amount: number | null;
    request: {
      request_number: string;
      title: string | null;
      vendor: { name: string; status: string; bank_account_number: string | null; bank_ifsc: string | null } | null;
      outlets: { outlet: { name: string } | null }[];
    };
  };

  const ready: (BankFileRow & { id: string })[] = [];
  for (const raw of (data ?? []) as unknown as Row[]) {
    const v = raw.request.vendor;
    // Same bar the manual flow applies: an unapproved vendor never gets paid.
    if (!v || v.status !== "approved") continue;
    if (!v.bank_account_number || !v.bank_ifsc) continue;
    // TDS is withheld by Accounts, so the bank is paid the net. The approved
    // figure stays untouched — that's what the approver agreed to and what
    // the PO balance tracks against.
    const net =
      Math.round((Number(raw.requested_amount) - Number(raw.tds_amount ?? 0)) * 100) / 100;
    // Fully withheld leaves nothing to transfer, and a zero-value row would
    // be rejected by the bank.
    if (net <= 0) continue;
    ready.push({
      id: raw.id,
      vendorName: v.name,
      vendorIfsc: v.bank_ifsc,
      vendorAccountNumber: v.bank_account_number,
      amount: net,
      outlet: raw.request.outlets?.[0]?.outlet?.name ?? "",
      title: raw.request.title ?? "",
    });
  }

  if (ready.length === 0) return back(req, "empty");

  const now = new Date();
  const stamp = formatBankDate(now).replace(/\//g, "-");
  const batchRef = batchReference(now, randomUUID());
  const filename = `${spec.label}-${stamp}-${batchRef}.${spec.ext}`;
  const uploadDate = new Date(now.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

  // Claim the rows BEFORE building anything, and build only from what the
  // claim actually committed.
  //
  // This used to run the other way round: the file was built from everything
  // selected, then the status move was attempted and its error thrown away.
  // Two ways that paid a vendor twice. If the move failed, the operator still
  // got a complete file, nothing was recorded, and the rows stayed queued —
  // so the next download re-paid the whole batch. And two people clicking
  // Download at once both got a full file, because only the second one's
  // UPDATE matched zero rows, which the response never reflected.
  const { data: moved, error: moveErr } = await admin
    .from("request_installments")
    // The queue marker has done its job once the row is in a file.
    .update({ status: "uploaded_in_bank", queued_for_upload_at: null, queued_by: null })
    .in("id", ready.map((r) => r.id))
    .eq("status", "approved") // guard: skip anything that changed underneath us
    .select("id, request_id, installment_number");

  // Hand over nothing we did not commit — a file without a recorded batch is
  // exactly what gets paid twice.
  if (moveErr) return back(req, "failed");
  const movedRows = (moved ?? []) as { id: string; request_id: string; installment_number: number }[];
  if (movedRows.length === 0) return back(req, "empty");

  const movedIds = new Set(movedRows.map((m) => m.id));
  const committed = ready.filter((r) => movedIds.has(r.id));

  let file: Buffer;
  try {
    file =
      bank === "icici"
        ? buildIciciFile(committed, debitAccount, now, batchRef)
        : buildKotakFile(committed, debitAccount, now, batchRef);
  } catch {
    // Claimed but unbuildable — put them back rather than leaving rows marked
    // as sent to a bank that never saw them.
    await admin
      .from("request_installments")
      .update({ status: "approved", queued_for_upload_at: now.toISOString(), queued_by: user.id })
      .in("id", [...movedIds]);
    return back(req, "failed");
  }

  const paidTo = new Map(committed.map((r) => [r.id, r]));
  await admin.from("payment_records").upsert(
    movedRows.map((m) => ({
      installment_id: m.id,
      request_id: m.request_id,
      bank_upload_date: uploadDate,
      bank_batch_ref: batchRef,
      // Vendor bank details can be corrected later; this is where the money
      // in THIS batch was actually sent.
      paid_to_account: paidTo.get(m.id)?.vendorAccountNumber?.trim() ?? null,
      paid_to_ifsc: paidTo.get(m.id)?.vendorIfsc?.trim().toUpperCase() ?? null,
    })),
    { onConflict: "installment_id" },
  );
  await admin.from("status_history").insert(
    movedRows.map((m) => ({
      request_id: m.request_id,
      installment_id: m.id,
      from_status: "approved",
      to_status: "uploaded_in_bank",
      actor_id: user.id,
      comment: `Included in ${spec.label} batch ${batchRef}`,
    })),
  );

  const skipped = (data ?? []).length - ready.length;
  return new NextResponse(new Uint8Array(file), {
    headers: {
      "Content-Type":
        bank === "icici"
          ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          : "application/vnd.ms-excel",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
      // Informational only — a browser can't read these off an attachment
      // response. The batch reference is in the filename and on every
      // payment_record, which is where anyone actually looks.
      "X-Bank-File-Count": String(committed.length),
      "X-Bank-File-Skipped": String(skipped),
    },
  });
}

/** Downloads are a form POST, so problems come back as a redirect + banner. */
function back(req: Request, reason: string) {
  return NextResponse.redirect(new URL(`/accounts?bankfile=${reason}`, req.url), 303);
}

export const dynamic = "force-dynamic";
