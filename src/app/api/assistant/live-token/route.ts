import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { TOOL_DECLARATIONS } from "@/lib/assistant/tools";
import { LIVE_MODEL, riaSystemInstruction } from "@/lib/assistant/live-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mints a short-lived token so the browser can open a Live API socket to
 * Google directly.
 *
 * The obvious design — proxy the WebSocket through here so the key stays
 * server-side — cannot work on this deployment: Vercel's Hobby plan caps a
 * function at 300 seconds with no override, so every call would be cut off
 * mid-sentence at five minutes. Ephemeral tokens solve the same problem
 * better: GEMINI_API_KEY never leaves this file, and the audio path has no
 * function-duration ceiling because it doesn't touch our compute at all.
 *
 * The token is locked down before it's handed over. A token in a browser is
 * a token the user can point at any prompt they like, so the model, the
 * output modality, the system instruction and the tool list are all pinned
 * here — otherwise someone could re-prompt Ria into a general-purpose chatbot
 * running on the company's quota.
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, is_active")
    .eq("id", user.id)
    .maybeSingle();
  const prof = profile as { full_name?: string; is_active?: boolean } | null;
  if (prof?.is_active === false) {
    return NextResponse.json({ error: "Your account is inactive." }, { status: 403 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Voice isn't configured yet (missing GEMINI_API_KEY)." },
      { status: 503 },
    );
  }

  const { data: roleRows } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id);
  const roles = ((roleRows ?? []) as { role: string }[]).map((r) => r.role);

  // Short window to START a session; the session itself then runs on its own.
  // 2 minutes is enough for a tap-to-talk and no use to anyone who scrapes it.
  const startBy = new Date(Date.now() + 2 * 60_000).toISOString();
  const expire = new Date(Date.now() + 32 * 60_000).toISOString();

  // Endpoint details verified against Google's ephemeral-tokens doc rather
  // than assumed: it is v1beta (not v1alpha), the key goes in the
  // x-goog-api-key HEADER (not a query parameter), and the model needs the
  // "models/" prefix. All three were wrong in the first cut and each one
  // fails the call on its own.
  const res = await fetch("https://generativelanguage.googleapis.com/v1beta/auth_tokens", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      uses: 1,
      expireTime: expire,
      newSessionExpireTime: startBy,
      // Pinned so a token loose in a browser can't be repurposed.
      // Only what matters for SECURITY is pinned here: which model runs, that
      // it answers in audio, who it thinks it is, and what it may look up.
      // Operational preferences — transcription, resumption, context
      // compression — are set by the client, because pinning fields the
      // constraint schema may not accept risks failing the mint outright, and
      // none of them are a way in.
      liveConnectConstraints: {
        model: `models/${LIVE_MODEL}`,
        config: {
          responseModalities: ["AUDIO"],
          systemInstruction: {
            parts: [{ text: riaSystemInstruction(prof?.full_name ?? "there", roles) }],
          },
          tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
        },
      },
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("live-token mint failed", res.status, detail.slice(0, 500));

    // Google returns {error:{code,message,status}}. Surfacing that message is
    // safe now the key travels in a header rather than the URL, and it is the
    // difference between an admin fixing this in a minute and guessing.
    // The first version hid it behind "try again in a moment", which is
    // advice to repeat something that will never work.
    let upstream = "";
    try {
      const parsed = JSON.parse(detail) as { error?: { message?: string; status?: string } };
      upstream = parsed.error?.message ?? "";
    } catch {
      upstream = detail.slice(0, 200);
    }

    const message =
      res.status === 401 || res.status === 403
        ? `The AI key was rejected. An admin should check GEMINI_API_KEY in Vercel. (${upstream || res.status})`
        : res.status === 404
          ? `Live voice isn't available to this key — check the model id in GEMINI_LIVE_MODEL and that the Generative Language API is enabled. (${upstream || res.status})`
          : res.status === 429
            ? `This key has no Live quota right now. (${upstream || res.status})`
            : `Couldn't start voice — ${upstream || `the AI service returned ${res.status}`}.`;
    return NextResponse.json({ error: message, status: res.status }, { status: 502 });
  }

  const body = (await res.json()) as { name?: string };
  if (!body.name) {
    return NextResponse.json({ error: "Couldn't start voice right now." }, { status: 502 });
  }

  // Only the token name goes to the browser. Never the API key.
  return NextResponse.json({ token: body.name, model: LIVE_MODEL });
}
