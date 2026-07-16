import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { cached, CACHE_TAGS, CACHE_TTL } from "@/lib/cache";

/**
 * Cached master-data lookups. These change rarely (admin edits categories /
 * outlets maybe once a week) so we cache them aggressively and revalidate
 * only when the admin console mutates them.
 *
 * Uses the admin client so RLS doesn't interfere with the cache — masters
 * are readable by all authenticated users anyway, so this is safe.
 */

export const getOutlets = cached(
  async () => {
    const admin = createAdminClient();
    const { data } = await admin
      .from("outlets")
      .select("id, code, name, cost_centre, is_active")
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

export const getCategories = cached(
  async () => {
    const admin = createAdminClient();
    const { data } = await admin
      .from("expense_categories")
      .select("id, name, is_active")
      .order("name");
    return data ?? [];
  },
  ["categories"],
  { revalidate: CACHE_TTL.masters, tags: [CACHE_TAGS.masters] },
);

export const getActiveCategories = cached(
  async () => {
    const admin = createAdminClient();
    const { data } = await admin
      .from("expense_categories")
      .select("id, name")
      .eq("is_active", true)
      .order("name");
    return data ?? [];
  },
  ["categories-active"],
  { revalidate: CACHE_TTL.masters, tags: [CACHE_TAGS.masters] },
);

export const getSubcategories = cached(
  async () => {
    const admin = createAdminClient();
    const { data } = await admin
      .from("expense_subcategories")
      .select("id, name, category_id, default_coa_head_id, is_active, coa_heads(name, code)")
      .order("name");
    return data ?? [];
  },
  ["subcategories"],
  { revalidate: CACHE_TTL.masters, tags: [CACHE_TAGS.masters] },
);

export const getActiveSubcategories = cached(
  async () => {
    const admin = createAdminClient();
    const { data } = await admin
      .from("expense_subcategories")
      .select("id, name, category_id, default_coa_head_id")
      .eq("is_active", true)
      .order("name");
    return data ?? [];
  },
  ["subcategories-active"],
  { revalidate: CACHE_TTL.masters, tags: [CACHE_TAGS.masters] },
);

export const getCoaHeads = cached(
  async () => {
    const admin = createAdminClient();
    const { data } = await admin
      .from("coa_heads")
      .select("id, code, name, is_active")
      .order("name");
    return data ?? [];
  },
  ["coa-heads"],
  { revalidate: CACHE_TTL.masters, tags: [CACHE_TAGS.masters] },
);

export const getActiveCoaHeads = cached(
  async () => {
    const admin = createAdminClient();
    const { data } = await admin
      .from("coa_heads")
      .select("id, code, name")
      .eq("is_active", true)
      .order("name");
    return data ?? [];
  },
  ["coa-heads-active"],
  { revalidate: CACHE_TTL.masters, tags: [CACHE_TAGS.masters] },
);
