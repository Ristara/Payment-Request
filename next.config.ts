import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  /* config options here */
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
