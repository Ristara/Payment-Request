/**
 * Expense-type vocabulary, split out from lib/access.ts because that file is
 * server-only and the Raise form is a client component.
 */
export type ExpenseType = "capex" | "opex";

/** The two ways a request can be started. */
export type RaiseModule = "payment" | "procurement";

export const MODULE_LABEL: Record<RaiseModule, string> = {
  payment: "Pay a vendor",
  procurement: "Buy or repair",
};

export const MODULE_HINT: Record<RaiseModule, string> = {
  payment: "Straight to a payment request",
  procurement: "Needs a PO first",
};

export const EXPENSE_LABEL: Record<ExpenseType, string> = {
  capex: "CapEx",
  opex: "OpEx",
};

export const EXPENSE_HINT: Record<ExpenseType, string> = {
  capex: "Assets & construction",
  opex: "Rent & utilities",
};

/**
 * Roles that may raise for any branch and either expense type without being
 * granted them one by one.
 *
 * Admin was here alone, for a bootstrap reason: a fresh install needs somebody
 * able to set the grants up. Approver and accounts are here for a different
 * reason — they already see, approve and pay every request in the company
 * regardless of branch, so making them ask permission to *raise* against a
 * branch they can already authorise payment for was a rule with no threat
 * behind it.
 *
 * This does not let an approver wave through their own spending:
 * approveInstallment refuses when the submitter is the approver, whoever they
 * are. That check is what makes this safe, so it must not be removed.
 *
 * Mirrored in SQL by may_raise_for_outlet / may_raise_expense /
 * may_raise_any_branch (migration 033). Change one and you must change the
 * other, or the form will offer a branch the database then rejects.
 */
export const UNRESTRICTED_RAISE_ROLES = ["admin", "approver", "accounts"] as const;

export function hasUnrestrictedRaise(roles: readonly string[]): boolean {
  return roles.some((r) => (UNRESTRICTED_RAISE_ROLES as readonly string[]).includes(r));
}
