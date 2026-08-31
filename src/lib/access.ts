import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export { EXPENSE_LABEL, EXPENSE_HINT, MODULE_LABEL, MODULE_HINT, hasUnrestrictedRaise } from "@/lib/access-labels";
import { EXPENSE_LABEL, MODULE_LABEL } from "@/lib/access-labels";
export type { ExpenseType, RaiseModule } from "@/lib/access-labels";
import type { ExpenseType, RaiseModule } from "@/lib/access-labels";

/**
 * What a person is allowed to RAISE for.
 *
 * Governs raising only. Seeing, approving and paying are decided by role and
 * are deliberately untouched — narrowing those would hide in-flight payments
 * from the people chasing them.
 *
 * No grants means nothing, not everything. That's the strict reading and it
 * was chosen on purpose, so a new joiner can't raise against a branch nobody
 * meant to give them. Admins, approvers and accounts are exempt — see
 * UNRESTRICTED_RAISE_ROLES for why each of them is on that list.
 */
export type RaiseAccess = {
  outletIds: string[];
  expenseTypes: ExpenseType[];
  /** Which raise paths are open to them — "Pay a vendor", "Buy or repair". */
  modules: RaiseModule[];
  /** Admins, approvers and accounts bypass all three lists. */
  unrestricted: boolean;
};

export async function getRaiseAccess(
  userId: string,
  /** From hasUnrestrictedRaise(roles) — admin, approver or accounts. */
  unrestricted: boolean,
): Promise<RaiseAccess> {
  if (unrestricted) {
    return {
      outletIds: [],
      expenseTypes: ["capex", "opex"],
      modules: ["payment", "procurement"],
      unrestricted: true,
    };
  }

  const admin = createAdminClient();
  const [branches, expenses, modules] = await Promise.all([
    admin.from("user_branch_access").select("outlet_id").eq("user_id", userId),
    admin.from("user_expense_access").select("expense_type").eq("user_id", userId),
    admin.from("user_module_access").select("module").eq("user_id", userId),
  ]);

  return {
    outletIds: ((branches.data ?? []) as { outlet_id: string }[]).map((r) => r.outlet_id),
    expenseTypes: ((expenses.data ?? []) as { expense_type: ExpenseType }[]).map((r) => r.expense_type),
    modules: ((modules.data ?? []) as { module: RaiseModule }[]).map((r) => r.module),
    unrestricted: false,
  };
}

/** The message to show, or null if this person may raise this. */
export function raiseDenied(
  access: RaiseAccess,
  outletIds: string[],
  expenseType: ExpenseType,
): string | null {
  if (access.unrestricted) return null;

  if (access.outletIds.length === 0) {
    return "You haven't been given any branches to raise for. Ask an admin to assign yours.";
  }
  if (!access.expenseTypes.includes(expenseType)) {
    return `You can't raise ${EXPENSE_LABEL[expenseType]} requests. Ask an admin if you should be able to.`;
  }
  const allowed = new Set(access.outletIds);
  const outside = outletIds.filter((id) => !allowed.has(id));
  if (outside.length > 0) {
    return "One of the branches you picked isn't yours to raise for.";
  }
  return null;
}

/**
 * May this person use this raise path at all?
 *
 * Separate from raiseDenied because it is asked earlier and in more places —
 * the nav asks it to decide whether to show a tab, and both New pages ask it
 * before rendering a form. raiseDenied answers the narrower question of
 * whether a specific branch and expense type are allowed.
 */
export function moduleDenied(access: RaiseAccess, module: RaiseModule): string | null {
  if (access.unrestricted) return null;
  if (!access.modules.includes(module)) {
    return `You don't have access to "${MODULE_LABEL[module]}". Ask an admin if you should.`;
  }
  return null;
}
