/**
 * Expense-type vocabulary, split out from lib/access.ts because that file is
 * server-only and the Raise form is a client component.
 */
export type ExpenseType = "capex" | "opex";

export const EXPENSE_LABEL: Record<ExpenseType, string> = {
  capex: "CapEx",
  opex: "OpEx",
};

export const EXPENSE_HINT: Record<ExpenseType, string> = {
  capex: "Assets & construction",
  opex: "Rent & utilities",
};
