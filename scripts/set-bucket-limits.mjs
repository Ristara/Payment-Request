/**
 * Sets the per-file size ceiling on the storage buckets.
 *
 * The app checks size before uploading (src/lib/uploads.ts) so the submitter
 * gets a useful message; this is the backstop that makes an oversized file
 * impossible regardless of which code path reaches storage. Keep the number
 * in step with MAX_UPLOAD_BYTES.
 *
 * Run: node --env-file=.env.local scripts/set-bucket-limits.mjs
 */
import { createClient } from "@supabase/supabase-js";

const LIMIT = 15 * 1024 * 1024;
const BUCKETS = ["request-attachments", "vendor-docs"];

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
);

for (const id of BUCKETS) {
  // MIME types are deliberately left unrestricted: phones send heic, some
  // browsers send application/octet-stream for a PDF, and a bucket-level
  // allowlist would reject those uploads outright.
  const { error } = await admin.storage.updateBucket(id, {
    public: false,
    fileSizeLimit: LIMIT,
  });
  console.log(error ? `${id}: FAILED — ${error.message}` : `${id}: limit set to 15 MB`);
  if (error) process.exitCode = 1;
}

const { data } = await admin.storage.listBuckets();
console.table(data.map((b) => ({ bucket: b.id, public: b.public, limit: b.file_size_limit })));
