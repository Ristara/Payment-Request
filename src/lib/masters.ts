import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { cached, CACHE_TAGS, CACHE_TTL } from "@/lib/cache";

/** Cached master-data lookups. */

export const getOutlets = cached(
  async () => {
    const admin = createAdminClient();
    const { data } = await admin
      .from("outlets")
      .select("id, code, name, is_active")
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
      .select("id, code, name")
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
      .select("id, code, subcategory, category, coa, is_active")
      .order("code");
    return data ?? [];
  },
  ["coa-accounts"],
  { revalidate: CACHE_TTL.masters, tags: [CACHE_TAGS.masters] },
);

/** Only active COA accounts — used to populate submitter dropdown. */
export const getActiveCoaAccounts = cached(
  async () => {
    const admin = createAdminClient();
    const { data } = await admin
      .from("coa_accounts")
      .select("id, code, subcategory, category, coa")
      .eq("is_active", true)
      .order("subcategory");
    return data ?? [];
  },
  ["coa-accounts-active"],
  { revalidate: CACHE_TTL.masters, tags: [CACHE_TAGS.masters] },
);
