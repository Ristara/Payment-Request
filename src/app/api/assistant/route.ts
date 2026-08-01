import { NextResponse } from "next/server";
import { COA_LABEL } from "@/lib/coa-labels";
import { TOOL_DECLARATIONS, runTool } from "@/lib/assistant/tools";
import { createClient } from "@/lib/supabase/server";
import { shortRequestNumber } from "@/lib/types";

export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// Ria — Raghav Intelligent Assistant — backed by Google Gemini with function
// calling.
//
// Privacy model: chats are NEVER stored — the client keeps the transcript in
// memory only and sends it with each request. Every data lookup below runs
// through the USER'S supabase client, so RLS scopes results exactly like the
// app does (submitters see their own threads; approvers/accounts see all).
// ---------------------------------------------------------------------------

// Alias that tracks Google's current Flash model — pinning an exact version
// breaks when it's retired (gemini-2.5-flash is already closed to new keys).
const GEMINI_MODEL = "gemini-flash-latest";
const MAX_TOOL_ROUNDS = 6;

type ChatMessage = { role: "user" | "assistant"; content: string };

type GeminiPart =
  | { text: string }
  | { functionCall: { name: string; args: Record<string, unknown> } }
  | { functionResponse: { name: string; response: Record<string, unknown> } };
type GeminiContent = { role: "user" | "model"; parts: GeminiPart[] };

// NOTE: zero-argument tools must OMIT `parameters` entirely — Gemini v1beta
// rejects an OBJECT schema with empty properties (400 INVALID_ARGUMENT).
// ------ Rate limiting ------
// Per-user sliding window, in process memory. On serverless this is
// per-instance, so it's a burst brake rather than a global quota — enough to
// stop tight loops from burning the shared key.
const RATE_LIMIT = 8;
const RATE_WINDOW_MS = 60_000;
const rateHits = new Map<string, number[]>();

function isRateLimited(userId: string): boolean {
  const now = Date.now();
  const recent = (rateHits.get(userId) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) {
    rateHits.set(userId, recent);
    return true;
  }
  recent.push(now);
  rateHits.set(userId, recent);
  return false;
}

/**
 * Gemini returns 503 ("model overloaded") and 429 under load. Both are
 * transient and clear in under a second, so ride them out rather than
 * surfacing a scary error for what is a momentary blip. Permanent failures
 * (bad key, bad request, missing model) are returned immediately.
 */
async function callGemini(url: string, body: string): Promise<Response> {
  const BACKOFF_MS = [400, 1200];
  let res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  for (const wait of BACKOFF_MS) {
    if (res.status !== 503 && res.status !== 429) return res;
    // A hard "no quota at all" will never succeed — don't waste retries.
    const peek = res.clone();
    const text = await peek.text().catch(() => "");
    if (res.status === 429 && text.includes("limit: 0")) return res;
    await new Promise((r) => setTimeout(r, wait));
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
  }
  return res;
}

// ------ Route handler ------

export async function POST(req: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Ria isn't configured yet (missing GEMINI_API_KEY)." },
      { status: 503 },
    );
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  if (isRateLimited(user.id)) {
    return NextResponse.json(
      { error: "You're asking very fast — give it a few seconds and try again." },
      { status: 429 },
    );
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const rawMessages = (raw as { messages?: unknown })?.messages;
  if (!Array.isArray(rawMessages)) {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  // Bound the context: last 16 turns, each truncated (not dropped) to 4000
  // chars, valid roles only, and consecutive same-role turns merged so the
  // Gemini contents sequence stays well-formed.
  let messages: ChatMessage[] = [];
  for (const m of rawMessages.slice(-16)) {
    if (!m || typeof m !== "object") continue;
    const role = (m as ChatMessage).role;
    const content = (m as ChatMessage).content;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string" || !content.trim()) continue;
    const trimmed = content.slice(0, 4000);
    const last = messages[messages.length - 1];
    if (last && last.role === role) last.content = `${last.content}\n${trimmed}`.slice(0, 4000);
    else messages.push({ role, content: trimmed });
  }
  // Gemini requires the conversation to start with a user turn.
  while (messages.length > 0 && messages[0].role !== "user") messages.shift();
  messages = messages.slice(-15);
  if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
    return NextResponse.json({ error: "No question found." }, { status: 400 });
  }

  const todayIST = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  const systemInstruction =
    `You are Ria, the in-app assistant for Ristara Foods' Payment Request system. `
    + `Ria stands for Raghav Intelligent Assistant — say so if anyone asks what your name means or where it comes from, and don't volunteer it otherwise. `
    + `Ria goes by he/him. `
    + `Answer as Ria — warm and direct, never robotic. Only introduce yourself if asked who you are. ` +
    `Answer questions about payment requests, approvals, vendors, payments and spend using ONLY the provided tools — never invent data. ` +
    `The tools already run with the current user's permissions. ` +
    `All amounts are INR: format like ₹1,23,456.78 (Indian grouping). Dates are IST; today is ${todayIST}. ` +
    `Request numbers look like PR-00134. Be brief and clear — plain text only, no markdown symbols like ** or #. ` +
    `Use short lines and simple lists. If the tools return nothing relevant, say you couldn't find it in the system. ` +
    `\n\nHow the system works, so your answers match it: a REQUEST is a thread for one PO with a title, a vendor, an outlet and line items whose sum is the PO value. ` +
    `Money is released through INSTALLMENTS against that PO, each with its own life: draft (recalled by the submitter) → pending approval → approved → uploaded in bank → invoice pending / payment processed → closed; or rejected. ` +
    `Accounts download a Kotak bank file which moves approved installments to "uploaded in bank". ` +
    `A payment cannot be approved until the vendor is approved, and a vendor cannot be approved without bank account, IFSC and mobile number — if someone asks why they cannot approve or pay something, check vendor_status first. ` +
    `The chart of accounts is three levels: ${COA_LABEL.level1} → ${COA_LABEL.level2} → ${COA_LABEL.level3}. A line with no ${COA_LABEL.level3.toLowerCase()} is charged to the whole ${COA_LABEL.level2.toLowerCase()}. Use those words with users — the underlying columns are named coa/category/subcategory, which they never see.`;

  const contents: GeminiContent[] = messages.map((m) => ({
    role: m.role === "user" ? "user" : "model",
    parts: [{ text: m.content }],
  }));

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const res = await callGemini(
      url,
      JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents,
        tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
        generationConfig: {
          temperature: 0.2,
          // Thinking can't be switched off on Gemini 3 (thinkingBudget: 0 is
          // rejected outright), and thought tokens are charged against this
          // budget — so leave enough room for reasoning AND the answer.
          maxOutputTokens: 4096,
        },
      }),
    );

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("[assistant] Gemini error", res.status, detail.slice(0, 500));
      // Setup problems (bad key, API not enabled) are actionable by an admin,
      // so name them instead of hiding behind a generic message. No key
      // material or upstream payload is ever echoed to the browser.
      let friendly: string;
      if (res.status === 503) {
        friendly = "Google's AI service is busy at the moment. Give it a few seconds and ask again.";
      } else if (res.status === 429 && detail.includes("limit: 0")) {
        // Must be tested BEFORE the general 429. It used to sit after it, so
        // this branch could never run and a key with no quota — the most
        // likely setup failure — reported "try again in a minute" forever.
        friendly =
          "This Gemini key has no request quota (its limit is 0). An admin should enable the Generative Language API on the key's Google Cloud project, or create the key from Google AI Studio.";
      } else if (res.status === 429) {
        friendly = "Ria is a bit busy right now (rate limited). Try again in a minute.";
      } else if (res.status === 401 || res.status === 403) {
        // Deliberately doesn't prescribe a key format. Both AIza… and AQ.…
        // keys authenticate; guessing at the prefix sent an admin chasing a
        // non-problem once already.
        friendly =
          "The AI key was rejected. An admin should check GEMINI_API_KEY in Vercel and redeploy.";
      } else if (res.status === 400) {
        friendly = "Ria couldn't process that request (code 400) — a setup issue, not your question.";
      } else if (res.status === 404) {
        friendly = "The AI model isn't available to this key (code 404). An admin should check the Generative Language API is enabled for the key's project.";
      } else {
        friendly = `Ria had a problem answering (code ${res.status}). Try again.`;
      }
      return NextResponse.json({ error: friendly }, { status: 502 });
    }

    const data = (await res.json()) as {
      candidates?: { content?: { role: string; parts?: GeminiPart[] }; finishReason?: string }[];
    };
    const candidate = data.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];
    const calls = parts.filter(
      (p): p is { functionCall: { name: string; args: Record<string, unknown> } } =>
        "functionCall" in p,
    );

    if (calls.length === 0 || round === MAX_TOOL_ROUNDS) {
      const text = parts
        .filter((p): p is { text: string } => "text" in p)
        .map((p) => p.text)
        .join("")
        .trim();
      if (text) return NextResponse.json({ reply: text });
      const fallback =
        candidate?.finishReason === "MAX_TOKENS"
          ? "That answer got too long — try asking a narrower question."
          : "Sorry, I couldn't put together an answer. Try rephrasing.";
      return NextResponse.json({ reply: fallback });
    }

    // Echo the model's parts back VERBATIM — Gemini 3 rejects a follow-up
    // whose functionCall has lost its thought_signature, so these objects
    // must never be rebuilt field by field.
    contents.push({ role: "model", parts });
    const responses: GeminiPart[] = [];
    for (const call of calls) {
      const result = await runTool(supabase, call.functionCall.name, call.functionCall.args ?? {});
      responses.push({
        functionResponse: {
          name: call.functionCall.name,
          response: { result },
        },
      });
    }
    contents.push({ role: "user", parts: responses });
  }

  return NextResponse.json({ error: "Ria took too long. Try a simpler question." }, { status: 502 });
}
