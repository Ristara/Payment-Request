import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Default is 1MB, which any phone-camera photo blows past. Attach
      // flows promise "up to 10 MB each" and allow multiple files, so give
      // generous headroom (multipart adds boundary/header overhead too).
      bodySizeLimit: "50mb",
    },
  },
};

export default withSentryConfig(nextConfig, {
  // Sentry Webpack plugin options — only run source-map upload on Vercel builds.
  org: "ristara-foods",           // update if your org slug differs
  project: "payment-app",
  silent: !process.env.CI,
  widenClientFileUpload: true,
  disableLogger: true,
  // Uploads are enabled only when SENTRY_AUTH_TOKEN is present.
});
