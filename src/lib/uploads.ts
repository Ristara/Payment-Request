/**
 * One ceiling for every attachment, enforced in two places: here, so the
 * submitter gets a sentence they can act on, and on the storage buckets
 * themselves, so nothing oversized can land even if a check is missed.
 *
 * Keep this in step with the buckets' file_size_limit (see
 * scripts/set-bucket-limits.mjs) — 15 MB comfortably covers a phone photo of
 * an invoice or a multi-page scanned PDF.
 */
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

/** The first file that's too big, phrased for the person who picked it. */
export function oversizedFile(files: Array<unknown>): string | null {
  for (const f of files) {
    if (f instanceof File && f.size > MAX_UPLOAD_BYTES) {
      const mb = (f.size / 1024 / 1024).toFixed(1);
      return `"${f.name}" is ${mb} MB — each file must be under 15 MB. A photo of the document is usually much smaller than a scan.`;
    }
  }
  return null;
}
