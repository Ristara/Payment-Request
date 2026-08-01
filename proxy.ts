import { updateSession } from "@/lib/supabase/proxy-helper";
import type { NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    // Run on every request except static assets, PWA files, and images.
    //
    // This used to carry `missing: [next-router-prefetch, purpose=prefetch]`
    // to skip <Link> prefetches. Those are request headers, so any client can
    // set them — which turned the session gate into something the caller
    // opted into. Server Actions are POSTed by ID and can be sent to any
    // route, so "every page calls requireUser() anyway" did not cover them.
    // The prefetch skip now lives in updateSession(), where it is limited to
    // GET.
    // ria-capture-worklet.js is excluded because it sits on the microphone
    // path: audioWorklet.addModule() fetches it before capture can start, and
    // running the session gate first meant a getClaims() call and cookie
    // fan-out ahead of a 1.7KB static file. It is public, unauthenticated
    // audio-conversion code with nothing in it worth gating.
    "/((?!_next/static|_next/image|favicon.ico|favicon-32.png|manifest\\.json|sw\\.js|robots\\.txt|sitemap\\.xml|apple-touch-icon.png|ria-capture-worklet\\.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
