import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Called from the top-level proxy.ts. Refreshes the auth session on every
 * request, syncs cookies to the response, and redirects unauthenticated
 * users to /login (except for public routes).
 *
 * Auth check uses getClaims(), which refreshes the session cookie if needed
 * (via getSession) and then verifies the JWT locally against a cached JWKS —
 * no network round-trip to Supabase Auth per request. The authoritative
 * getUser() check still happens once per render in src/lib/auth.ts.
 * Note: local verification requires the Supabase project to use asymmetric
 * JWT signing keys; on legacy HS256 the client transparently falls back to
 * a network check, which is no worse than the previous behavior.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Refresh the session cookie if needed + verify the JWT (locally when the
  // project uses asymmetric signing keys).
  const { data: claimsData } = await supabase.auth.getClaims();
  const isAuthed = !!claimsData?.claims;

  const pathname = request.nextUrl.pathname;
  const isPublicRoute =
    pathname === "/login" ||
    pathname === "/" ||
    pathname === "/manifest.json" ||
    pathname === "/sw.js" ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/auth/callback");

  if (!isAuthed && !isPublicRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return response;
}
