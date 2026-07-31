/**
 * A GSTIN carries the holder's PAN inside it.
 *
 *   2 2 A A A A A 0 0 0 0 A 1 Z 5
 *   └┬┘ └────────┬────────┘ │ │ └── checksum
 *    │           │          │ └──── always 'Z'
 *    │           │          └────── entity number for that PAN in the state
 *    │           └───────────────── the PAN, characters 3-12
 *    └───────────────────────────── state code
 *
 * So the two can never legitimately disagree, and asking someone to type both
 * only creates the opportunity for them to.
 */
export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

/** The PAN embedded in a GSTIN, or "" if there isn't enough typed yet. */
export function panFromGstin(gstin: string | null | undefined): string {
  const g = (gstin ?? "").trim().toUpperCase();
  return g.length >= 12 ? g.slice(2, 12) : "";
}
