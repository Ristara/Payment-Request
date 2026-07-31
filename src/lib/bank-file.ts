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
  /** Request title — ICICI's narration names what the payment is for. */
  title?: string;
};

/**
 * IFT is an internal transfer, so it applies when the beneficiary also banks
 * with Kotak (KKBK); everything else goes out as NEFT. Matches the sample
 * file Kotak supplied.
 */
const IFT_BANK_PREFIX = "KKBK";

export function paymentTypeFor(ifsc: string): "IFT" | "NEFT" {
  return ifsc.trim().toUpperCase().startsWith(IFT_BANK_PREFIX) ? "IFT" : "NEFT";
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

// ---------------------------------------------------------------------------
// ICICI
// ---------------------------------------------------------------------------

/**
 * ICICI Corporate Internet Banking bulk-upload file.
 *
 * Nineteen columns, one header row, .xlsx — a much plainer format than
 * Kotak's. Header text and order match the sample Accounts supplied; note
 * that ADDL_INFO3 genuinely does not exist between ADDL_INFO2 and
 * ADDL_INFO4, which looks like an error but is what the bank's template has.
 *
 * Only the ten columns the sample fills are populated. The rest are left
 * empty rather than guessed at, because a file the bank rejects is worse
 * than one carrying less optional detail.
 */
export const ICICI_HEADER = [
  "PYMT_PROD_TYPE_CODE", "PYMT_MODE", "DEBIT_ACC_NO", "BNF_NAME", "BENE_ACC_NO",
  "BENE_IFSC", "AMOUNT", "DEBIT_NARR", "CREDIT_NARR", "MOBILE_NUM",
  "EMAIL_ID", "REMARK", "PYMT_DATE", "REF_NO", "ADDL_INFO1",
  "ADDL_INFO2", "ADDL_INFO4", "ADDL_INFO5", "LEI_NUMBER",
] as const;

export const ICICI_CONSTANTS = {
  productTypeCode: "PAB_VENDOR",
  paymentMode: "NEFT",
  creditNarration: "Ristara Foods",
} as const;

/**
 * ICICI's sample narrates the outlet(s) and what the money is for
 * ("JPN and SJP Hood Lights"), where Kotak's leads with the vendor. Follow
 * each bank's own convention rather than imposing one on both.
 */
export function iciciNarration(outlet: string, title: string): string {
  return `${outlet.trim()} ${title.trim()}`.trim().slice(0, NARRATION_MAX);
}

/** DD-MM-YYYY in IST — hyphens here, unlike Kotak's slashes. */
export function formatIciciDate(d: Date): string {
  return formatBankDate(d).replace(/\//g, "-");
}

export function buildIciciFile(rows: BankFileRow[], debitAccount: string, when: Date): Buffer {
  const payDate = formatIciciDate(when);

  const aoa: (string | number)[][] = [
    [...ICICI_HEADER],
    ...rows.map((r) => [
      ICICI_CONSTANTS.productTypeCode,
      ICICI_CONSTANTS.paymentMode,
      debitAccount,
      r.vendorName,
      r.vendorAccountNumber,
      r.vendorIfsc.trim().toUpperCase(),
      // The sample carries AMOUNT as text, so match it — that is the file
      // the bank has demonstrably accepted.
      String(Math.round(r.amount * 100) / 100),
      iciciNarration(r.outlet, r.title ?? r.vendorName),
      ICICI_CONSTANTS.creditNarration,
      "", "", "",
      payDate,
      "", "", "", "", "", "",
    ]),
  ];

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return XLSX.write(wb, { bookType: "xlsx", type: "buffer" }) as Buffer;
}

/** The banks Accounts can pay from. */
export type BankKey = "kotak" | "icici";

export const BANKS: Record<BankKey, { label: string; ext: string; envVar: string }> = {
  kotak: { label: "Kotak", ext: "xls", envVar: "KOTAK_DEBIT_ACCOUNT" },
  icici: { label: "ICICI", ext: "xlsx", envVar: "ICICI_DEBIT_ACCOUNT" },
};
