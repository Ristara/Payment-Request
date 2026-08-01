import { NextResponse } from "next/server";
import { GoogleGenAI, Modality, type FunctionDeclaration } from "@google/genai";
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

  // Minted with Google's own SDK rather than a hand-built fetch. The first
  // two attempts got this wrong in three different ways — wrong API version,
  // key in the query string instead of the header, model id missing its
  // "models/" prefix — because the REST shape was inferred rather than read.
  // The SDK knows all of it. Constrained tokens are v1alpha only.
  const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "v1alpha" } });

  let token: string | undefined;
  try {
    const created = await ai.authTokens.create({
      config: {
        uses: 1,
        expireTime: expire,
        newSessionExpireTime: startBy,
        // Pinned so a token loose in a browser can't be repurposed: which
        // model runs, that it answers in audio, who it thinks it is, and what
        // it may look up.
        liveConnectConstraints: {
          model: LIVE_MODEL,
          config: {
            responseModalities: [Modality.AUDIO],
            systemInstruction: riaSystemInstruction(prof?.full_name ?? "there", roles),
            // TOOL_DECLARATIONS is written for the REST API, where the type
            // names are the plain strings "OBJECT"/"STRING". Those are the
            // enum's runtime values too, so the shape is right and only the
            // SDK's stricter typing needs the cast.
            tools: [
              { functionDeclarations: TOOL_DECLARATIONS as unknown as FunctionDeclaration[] },
            ],
            // These have to be here rather than on the client. With the
            // constraint set and lockAdditionalFields omitted, every field is
            // locked and anything the client asks for is silently IGNORED —
            // so transcription set browser-side would simply never happen,
            // and the conversation would never appear in the chat log.
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            contextWindowCompression: { slidingWindow: {} },
            sessionResumption: {},
          },
        },
        // Deliberately omitted. An empty array is what produced
        // "field_mask is invalid for BidiGenerateContentSetup"; leaving it out
        // locks exactly the fields set above, which is what we want anyway.
      },
    });
    token = created.name;
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error("live-token mint failed", detail.slice(0, 500));
    // Surfaced rather than swallowed: the reason was only ever in a server
    // log neither the user nor I read.
    return NextResponse.json(
      { error: `Couldn't start voice — ${detail.slice(0, 200)}` },
      { status: 502 },
    );
  }

  if (!token) {
    return NextResponse.json({ error: "Couldn't start voice right now." }, { status: 502 });
  }

  // Only the token name goes to the browser. Never the API key.
  return NextResponse.json({ token, model: LIVE_MODEL });
}
