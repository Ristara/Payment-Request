// Client-side Sentry init. Under Turbopack (Next.js 16 default) this file
// convention — instrumentation-client.ts — is what actually ships to the
// browser bundle; the old sentry.client.config.ts was only picked up by the
// webpack plugin and was silently dead.
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Sample all errors + a low percentage of successful transactions.
  tracesSampleRate: 0.1,

  // Session replay off (privacy + bundle size + free-tier friendly).
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,

  // Disable in local dev so we don't pollute Sentry with noise.
  enabled: process.env.NODE_ENV === "production",
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
