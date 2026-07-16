import { unstable_cache, updateTag } from "next/cache";

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
  masters: 300,      // 5 min — barely change
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
 */
export function invalidateMasters() { updateTag(CACHE_TAGS.masters); }
export function invalidateVendors() { updateTag(CACHE_TAGS.vendors); }
export function invalidateRequests() { updateTag(CACHE_TAGS.requests); }
export function invalidateApprovals() { updateTag(CACHE_TAGS.approvals); }
export function invalidateAccounts() { updateTag(CACHE_TAGS.accounts); }
export function invalidateNotifications(userId: string) {
  updateTag(CACHE_TAGS.notifications(userId));
}
