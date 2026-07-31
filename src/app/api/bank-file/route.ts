import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  BANKS,
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
  if (!roles.has("accounts") && !roles.has("admin")) return back(req, "forbidden");

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
  const filename = `${spec.label}-${stamp}.${spec.ext}`;
  const file =
    bank === "icici"
      ? buildIciciFile(ready, debitAccount, now)
      : buildKotakFile(ready, debitAccount, now);

  // Move them on only after the file is successfully built.
  const uploadDate = new Date(now.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  const ids = ready.map((r) => r.id);
  const { data: moved } = await admin
    .from("request_installments")
    // The marker has done its job once the row is in a file.
    .update({ status: "uploaded_in_bank", queued_for_upload_at: null, queued_by: null })
    .in("id", ids)
    .eq("status", "approved") // guard: skip anything that changed underneath us
    .select("id, request_id, installment_number");

  const movedRows = (moved ?? []) as { id: string; request_id: string; installment_number: number }[];
  if (movedRows.length > 0) {
    await admin.from("payment_records").upsert(
      movedRows.map((m) => ({
        installment_id: m.id,
        request_id: m.request_id,
        bank_upload_date: uploadDate,
        bank_batch_ref: filename,
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
        comment: `Included in bank file ${filename}`,
      })),
    );
  }

  const skipped = (data ?? []).length - ready.length;
  return new NextResponse(new Uint8Array(file), {
    headers: {
      "Content-Type":
        bank === "icici"
          ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          : "application/vnd.ms-excel",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
      // Surfaced by the Accounts page banner after the download.
      "X-Bank-File-Count": String(movedRows.length),
      "X-Bank-File-Skipped": String(skipped),
    },
  });
}

/** Downloads are a form POST, so problems come back as a redirect + banner. */
function back(req: Request, reason: string) {
  return NextResponse.redirect(new URL(`/accounts?bankfile=${reason}`, req.url), 303);
}

export const dynamic = "force-dynamic";
