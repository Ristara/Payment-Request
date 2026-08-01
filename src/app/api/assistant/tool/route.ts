import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { TOOL_DECLARATIONS, runTool } from "@/lib/assistant/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Runs one of Ria's tools for the voice path.
 *
 * In a text chat the model's tool calls are handled inside our own route. In
 * a voice session the model is talking to the browser directly, so the tool
 * call arrives there — and the browser is exactly where we don't want data
 * access to live. So it posts the call here instead, and this runs it the
 * same way the text route does: against the user's own cookie-authenticated
 * Supabase client, under RLS.
 *
 * That matters more than it looks. The browser chooses which tool name to
 * send, so it could ask for anything. It doesn't get anything the person
 * couldn't already see in the app, because the query runs as them.
 */
const ALLOWED = new Set(TOOL_DECLARATIONS.map((t) => t.name));

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_active")
    .eq("id", user.id)
    .maybeSingle();
  if ((profile as { is_active?: boolean } | null)?.is_active === false) {
    return NextResponse.json({ error: "Your account is inactive." }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as {
    name?: string;
    args?: Record<string, unknown>;
  } | null;
  const name = String(body?.name ?? "");
  if (!ALLOWED.has(name)) {
    // Named allowlist rather than passing the string through: runTool's
    // default branch is friendly, but this is a public endpoint.
    return NextResponse.json({ error: `Unknown tool.` }, { status: 400 });
  }

  const result = await runTool(supabase, name, body?.args ?? {});
  return NextResponse.json({ result });
}
