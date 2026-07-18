import { updateSession } from "@/lib/supabase/proxy-helper";
import type { NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    {
      // Run on every request except static assets, PWA files, and images.
      // The `missing` conditions skip <Link> prefetches — those RSC requests
      // don't need a session refresh, and every page still enforces auth at
      // render time via requireUser().
      source:
        "/((?!_next/static|_next/image|favicon.ico|favicon-32.png|manifest\\.json|sw\\.js|robots\\.txt|sitemap\\.xml|apple-touch-icon.png|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
