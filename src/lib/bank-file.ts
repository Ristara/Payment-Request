import "server-only";
import * as XLSX from "xlsx";

/**
 * Kotak bulk-payment upload file (RPAY).
 *
 * Column order and the single sheet name "electronic" match the sample file
 * Kotak supplies — the portal parses by position, so nothing here may be
 * reordered or renamed. Only ten of the 49 columns carry data; the rest are
 * present but empty, exactly as in the sample.
 */

export const KOTAK_HEADER = [
  "Client_Code", "Product_Code", "Payment_Type", "Payment_Ref_No.", "Payment_Date",
  "Instrument Date", "Dr_Ac_No", "Amount", "Bank_Code_Indicator", "Beneficiary_Code",
  "Beneficiary_Name", "Beneficiary_Bank", "Beneficiary_Branch / IFSC Code",
  "Beneficiary_Acc_No", "Location", "Print_Location", "Instrument_Number",
  "Ben_Add1", "Ben_Add2", "Ben_Add3", "Ben_Add4", "Beneficiary_Email",
  "Beneficiary_Mobile", "Debit_Narration", "Credit_Narration",
  "Payment Details 1", "Payment Details 2", "Payment Details 3", "Payment Details 4",
  ...Array.from({ length: 20 }, (_, i) => `Enrichment_${i + 1}`),
] as const;

/** Fixed values agreed with Accounts. */
export const KOTAK_CONSTANTS = {
  clientCode: "RISTARA",
  productCode: "RPAY",
  /** "M" = beneficiary identified by IFSC. */
  bankCodeIndicator: "M",
  creditNarration: "Ristara Foods",
} as const;

/** Kotak truncates long narrations — keep well inside the limit. */
const NARRATION_MAX = 30;

export type BankFileRow = {
  vendorName: string;
  vendorIfsc: string;
  vendorAccountNumber: string;
  amount: number;
  outlet: string;
};

/** Kotak-to-Kotak transfers are internal (IFT); everything else is NEFT. */
export function paymentTypeFor(ifsc: string): "IFT" | "NEFT" {
  return ifsc.trim().toUpperCase().startsWith("KKBK") ? "IFT" : "NEFT";
}

/** DD/MM/YYYY in IST — the sample's format, and the bank's expectation. */
export function formatBankDate(d: Date): string {
  const ist = new Date(d.getTime() + 5.5 * 3600 * 1000);
  const dd = String(ist.getUTCDate()).padStart(2, "0");
  const mm = String(ist.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${ist.getUTCFullYear()}`;
}

/**
 * "<first 8 chars of vendor name> <branch>" — what shows on the Kotak
 * statement, so it must identify the payee and the site at a glance.
 */
export function debitNarration(vendorName: string, outlet: string): string {
  const who = vendorName.trim().slice(0, 8).trim();
  return `${who} ${outlet.trim()}`.trim().slice(0, NARRATION_MAX);
}

export function buildKotakFile(rows: BankFileRow[], debitAccount: string, when: Date): Buffer {
  const paymentDate = formatBankDate(when);
  const blank = (n: number) => Array.from({ length: n }, () => "");

  const aoa: (string | number)[][] = [
    [...KOTAK_HEADER],
    ...rows.map((r) => [
      KOTAK_CONSTANTS.clientCode,
      KOTAK_CONSTANTS.productCode,
      paymentTypeFor(r.vendorIfsc),
      "",                       // Payment_Ref_No.
      paymentDate,
      "",                       // Instrument Date
      debitAccount,
      // Numeric so the portal doesn't read it as text.
      Math.round(r.amount * 100) / 100,
      KOTAK_CONSTANTS.bankCodeIndicator,
      "",                       // Beneficiary_Code
      r.vendorName,
      "",                       // Beneficiary_Bank (IFSC is authoritative)
      r.vendorIfsc.trim().toUpperCase(),
      r.vendorAccountNumber.trim(),
      ...blank(2),              // Location, Print_Location
      "",                       // Instrument_Number
      ...blank(4),              // Ben_Add1..4
      ...blank(2),              // Beneficiary_Email, Beneficiary_Mobile
      debitNarration(r.vendorName, r.outlet),
      KOTAK_CONSTANTS.creditNarration,
      ...blank(4),              // Payment Details 1..4
      ...blank(20),             // Enrichment_1..20
    ]),
  ];

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  // Sheet name must stay "electronic" — the portal looks for it.
  XLSX.utils.book_append_sheet(wb, ws, "electronic");
  // biff8 = the legacy .xls the portal accepts; .xlsx is rejected.
  return XLSX.write(wb, { bookType: "biff8", type: "buffer" }) as Buffer;
}
