import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Supabase redirects here after a successful OAuth handshake.
 * We exchange the ?code= for a session, ensure profile exists + is active,
 * enforce the @ristarafoods.com email domain, then bounce to /dashboard (or `next`).
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error.message)}`);
  }

  // Enforce ristarafoods.com domain even if Google 'hd' parameter is bypassed.
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(`${origin}/login?error=no_user`);
  }
  const email = (user.email ?? "").toLowerCase();
  if (!email.endsWith("@ristarafoods.com")) {
    // Force-sign-out and reject.
    await supabase.auth.signOut();
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent("Only @ristarafoods.com Google accounts are allowed.")}`,
    );
  }

  // Make sure a profile row exists (the trigger creates it, but be defensive
  // in case the trigger was ever missed).
  const admin = createAdminClient();
  await admin.from("profiles").upsert({
    id: user.id,
    email,
    full_name: (user.user_metadata?.full_name as string | undefined) ?? email.split("@")[0],
  }, { onConflict: "id" });

  return NextResponse.redirect(`${origin}${next}`);
}
