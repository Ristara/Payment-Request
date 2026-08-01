import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { cached, CACHE_TAGS, CACHE_TTL } from "@/lib/cache";

/** Cached master-data lookups. */

export const getOutlets = cached(
  async () => {
    const admin = createAdminClient();
    const { data } = await admin
      .from("outlets")
      .select("id, code, name, is_active, stage")
      .order("name");
    return data ?? [];
  },
  ["outlets"],
  { revalidate: CACHE_TTL.masters, tags: [CACHE_TAGS.masters] },
);

export const getActiveOutlets = cached(
  async () => {
    const admin = createAdminClient();
    const { data } = await admin
      .from("outlets")
      .select("id, code, name, stage")
      .eq("is_active", true)
      .order("name");
    return data ?? [];
  },
  ["outlets-active"],
  { revalidate: CACHE_TTL.masters, tags: [CACHE_TAGS.masters] },
);

/** Full COA table (all rows). */
export const getCoaAccounts = cached(
  async () => {
    const admin = createAdminClient();
    const { data } = await admin
      .from("coa_accounts")
      .select("id, code, subcategory, category, coa, is_active, expense_type")
      .order("code");
    return data ?? [];
  },
  ["coa-accounts"],
  { revalidate: CACHE_TTL.masters, tags: [CACHE_TAGS.masters] },
);

/**
 * Active accounts from BOTH charts. The Raise form narrows to the one that
 * matches the expense type — fetching once keeps this cached as a single
 * masters lookup rather than two that fall out of step.
 */
export const getActiveCoaAccounts = cached(
  async () => {
    const admin = createAdminClient();
    const { data } = await admin
      .from("coa_accounts")
      .select("id, code, subcategory, category, coa, expense_type")
      .eq("is_active", true)
      .order("subcategory");
    return data ?? [];
  },
  ["coa-accounts-active"],
  { revalidate: CACHE_TTL.masters, tags: [CACHE_TAGS.masters] },
);
