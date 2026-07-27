import { revalidateTag, unstable_cache, updateTag } from "next/cache";

/**
 * Tags used to invalidate specific slices of cached data.
 * Kept in one place so we don't misspell tag names across the app.
 */
export const CACHE_TAGS = {
  masters: "masters",              // outlets, categories, subcategories, coa
  vendors: "vendors",              // vendor list + counts
  requests: "requests",            // request list + counts
  notifications: (userId: string) => `notifications:${userId}`,
  approvals: "approvals",          // approvals queue count
  accounts: "accounts",            // accounts queue count
} as const;

/** Cache lifetimes in seconds. */
export const CACHE_TTL = {
  masters: 60,       // 1 min — small queries; keeps admin edits feeling live
  counts: 30,        // 30 sec — quick refresh for badges/tiles
  spend: 60,         // 1 min for the dashboard chart
  vendors: 60,
} as const;

/** Typed wrapper over unstable_cache with our defaults. */
export function cached<Args extends unknown[], T>(
  fn: (...args: Args) => Promise<T>,
  keyParts: string[],
  options: { revalidate: number; tags: string[] },
) {
  return unstable_cache(fn, keyParts, options);
}

/**
 * Call from server actions after a mutation to bust the relevant cache tags.
 *
 * These caches are unstable_cache entries, whose tags are invalidated by
 * revalidateTag — updateTag belongs to the newer `use cache` / cacheTag API
 * and does NOT clear them. Both are issued: revalidateTag does the real work
 * here, updateTag keeps read-your-own-writes semantics if a helper is ever
 * migrated to `use cache`. updateTag throws outside a Server Action, so it is
 * guarded.
 */
function bust(tag: string) {
  // expire: 0 — an admin editing a master should see it on the next page
  // load, not after a stale-while-revalidate round trip.
  revalidateTag(tag, { expire: 0 });
  try {
    updateTag(tag);
  } catch {
    // Not in a Server Action (route handler, etc.) — revalidateTag is enough.
  }
}

export function invalidateMasters() { bust(CACHE_TAGS.masters); }
export function invalidateVendors() { bust(CACHE_TAGS.vendors); }
export function invalidateRequests() { bust(CACHE_TAGS.requests); }
export function invalidateApprovals() { bust(CACHE_TAGS.approvals); }
export function invalidateAccounts() { bust(CACHE_TAGS.accounts); }
export function invalidateNotifications(userId: string) {
  bust(CACHE_TAGS.notifications(userId));
}
