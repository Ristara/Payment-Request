import { NextResponse } from "next/server";
import { COA_LABEL } from "@/lib/coa-labels";
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
const TOOL_DECLARATIONS = [
  {
    name: "list_my_requests",
    description:
      "List recent payment request threads visible to the current user (their own + CC'd for submitters; all for approvers/accounts). Returns number, title, vendor, PO value and installment statuses.",
  },
  {
    name: "list_pending_approvals",
    description:
      "List installments currently waiting for approval (pending approval or clarification required).",
  },
  {
    name: "get_request",
    description:
      "Get full details of one payment request by its number, e.g. 'PR-00134', '00134' or 'PR-2026-00134'. Includes title, vendor, PO value, installments with statuses and payments.",
    parameters: {
      type: "OBJECT",
      properties: {
        number: { type: "STRING", description: "The request number in any format" },
      },
      required: ["number"],
    },
  },
  {
    name: "vendor_payments",
    description:
      "Total paid and recent payment records for a vendor (searched by partial name).",
    parameters: {
      type: "OBJECT",
      properties: {
        vendor_name: { type: "STRING", description: "Partial or full vendor name" },
      },
      required: ["vendor_name"],
    },
  },
  {
    name: "list_overdue",
    description:
      "List unpaid installments whose payment due date has already passed.",
  },
  {
    name: "list_ready_to_pay",
    description:
      "Approved installments waiting to go to the bank, split into those the Kotak bank file can take and those held back because the vendor isn't approved or has no account number / IFSC.",
  },
  {
    name: "vendor_status",
    description:
      "Look up a vendor by partial name: approval status, whether bank details and mobile number are on file, and what is missing. Use this to answer why a payment can't be approved or paid.",
    parameters: {
      type: "OBJECT",
      properties: { vendor_name: { type: "STRING", description: "Partial or full vendor name" } },
      required: ["vendor_name"],
    },
  },
  {
    name: "spend_by_category",
    description:
      "Total spend grouped by chart-of-accounts category, counting only requests with at least one approved-or-later installment.",
  },
];

// ------ Tool implementations (all through the user's RLS-scoped client) ------

type Supa = Awaited<ReturnType<typeof createClient>>;

async function listMyRequests(supabase: Supa) {
  const { data, error } = await supabase
    .from("payment_requests")
    .select(
      `request_number, title, created_at, vendor:vendors(name),
       line_items:request_line_items(amount),
       installments:request_installments(installment_number, status, requested_amount, payment_due_date)`,
    )
    .order("created_at", { ascending: false })
    .limit(25);
  if (error) return { error: error.message };
  return {
    requests: (data ?? []).map((r) => {
      const row = r as unknown as {
        request_number: string; title: string | null; created_at: string;
        vendor: { name: string } | null;
        line_items: { amount: number }[];
        installments: { installment_number: number; status: string; requested_amount: number; payment_due_date: string }[];
      };
      return {
        number: shortRequestNumber(row.request_number),
        title: row.title,
        vendor: row.vendor?.name,
        po_value: row.line_items.reduce((s, l) => s + Number(l.amount), 0),
        installments: row.installments.map((i) => ({
          n: i.installment_number, status: i.status,
          amount: Number(i.requested_amount), due: i.payment_due_date,
        })),
      };
    }),
  };
}

async function listPendingApprovals(supabase: Supa) {
  const { data, error } = await supabase
    .from("request_installments")
    .select(
      `installment_number, requested_amount, submitted_at, status,
       request:payment_requests!inner(request_number, title, vendor:vendors(name))`,
    )
    .in("status", ["pending_approval", "clarification_required"])
    .order("submitted_at", { ascending: false })
    .limit(25);
  if (error) return { error: error.message };
  return {
    pending: (data ?? []).map((r) => {
      const row = r as unknown as {
        installment_number: number; requested_amount: number; submitted_at: string; status: string;
        request: { request_number: string; title: string | null; vendor: { name: string } | null };
      };
      return {
        number: shortRequestNumber(row.request.request_number),
        installment: row.installment_number,
        title: row.request.title,
        vendor: row.request.vendor?.name,
        amount: Number(row.requested_amount),
        status: row.status,
        submitted_at: row.submitted_at,
      };
    }),
  };
}

async function getRequest(supabase: Supa, numberRaw: string) {
  // Keep only digits, drop a leading year, and zero-pad to the 5-digit
  // sequence — "PR-00134", "134", "PR-2026-00134" all resolve exactly, and
  // no LIKE wildcards from the input can reach the query.
  let digits = String(numberRaw).replace(/^\s*pr[-\s]*/i, "").replace(/^\d{4}-/, "").replace(/\D/g, "");
  if (digits.length > 5) digits = digits.slice(-5);
  if (!digits) return { error: "No request number given." };
  const padded = digits.padStart(5, "0");
  const { data, error } = await supabase
    .from("payment_requests")
    .select(
      `request_number, title, purpose, created_at, payment_kind,
       vendor:vendors(name, status),
       line_items:request_line_items(amount, coa_account:coa_accounts(subcategory, category)),
       installments:request_installments(installment_number, status, requested_amount, payment_due_date,
         payment_record:payment_records(paid_amount, payment_date, utr_reference))`,
    )
    .like("request_number", `%-${padded}`)
    .limit(1)
    .maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: `No request found matching "${numberRaw}" (or you don't have access to it).` };
  const row = data as unknown as {
    request_number: string; title: string | null; purpose: string; created_at: string; payment_kind: string | null;
    vendor: { name: string; status: string } | null;
    line_items: { amount: number; coa_account: { subcategory: string; category: string } | null }[];
    installments: {
      installment_number: number; status: string; requested_amount: number; payment_due_date: string;
      payment_record: { paid_amount: number | null; payment_date: string | null; utr_reference: string | null }[] | { paid_amount: number | null; payment_date: string | null; utr_reference: string | null } | null;
    }[];
  };
  return {
    number: shortRequestNumber(row.request_number),
    title: row.title,
    purpose: row.purpose,
    vendor: row.vendor?.name,
    payment_kind: row.payment_kind,
    po_value: row.line_items.reduce((s, l) => s + Number(l.amount), 0),
    lines: row.line_items.map((l) => ({
      amount: Number(l.amount),
      subcategory: l.coa_account?.subcategory,
      category: l.coa_account?.category,
    })),
    installments: row.installments.map((i) => {
      const pr = Array.isArray(i.payment_record) ? i.payment_record[0] : i.payment_record;
      return {
        n: i.installment_number, status: i.status, amount: Number(i.requested_amount),
        due: i.payment_due_date,
        paid: pr?.paid_amount ? Number(pr.paid_amount) : null,
        paid_on: pr?.payment_date ?? null,
        utr: pr?.utr_reference ?? null,
      };
    }),
  };
}

async function vendorPayments(supabase: Supa, vendorName: string) {
  const name = String(vendorName).trim();
  if (!name) return { error: "No vendor name given." };
  const safeName = name.replace(/[%_\\]/g, " ").trim();
  const { data: vendors, error: vErr } = await supabase
    .from("vendors")
    .select("id, name")
    .ilike("name", `%${safeName}%`)
    .limit(5);
  if (vErr) return { error: vErr.message };
  if (!vendors?.length) return { error: `No vendor matching "${name}".` };

  const results = [];
  for (const v of vendors) {
    const { data: threads } = await supabase
      .from("payment_requests")
      .select(
        `request_number, title,
         installments:request_installments(status, requested_amount,
           payment_record:payment_records(paid_amount, payment_date))`,
      )
      .eq("vendor_id", v.id)
      .limit(50);
    const truncated = (threads?.length ?? 0) === 50;
    let paidTotal = 0;
    const payments: { number: string; amount: number; date: string | null }[] = [];
    for (const t of (threads ?? []) as unknown as {
      request_number: string;
      installments: { payment_record: { paid_amount: number | null; payment_date: string | null }[] | { paid_amount: number | null; payment_date: string | null } | null }[];
    }[]) {
      for (const i of t.installments) {
        const pr = Array.isArray(i.payment_record) ? i.payment_record[0] : i.payment_record;
        if (pr?.paid_amount) {
          paidTotal += Number(pr.paid_amount);
          payments.push({
            number: shortRequestNumber(t.request_number),
            amount: Number(pr.paid_amount),
            date: pr.payment_date,
          });
        }
      }
    }
    results.push({
      vendor: v.name,
      total_paid: paidTotal,
      total_is_partial: truncated,
      payments: payments.slice(0, 15),
    });
  }
  return { vendors: results };
}

async function listOverdue(supabase: Supa) {
  const todayIST = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("request_installments")
    .select(
      `installment_number, requested_amount, payment_due_date, status,
       request:payment_requests!inner(request_number, title, vendor:vendors(name))`,
    )
    .lt("payment_due_date", todayIST)
    .in("status", ["pending_approval", "clarification_required", "approved", "uploaded_in_bank"])
    .order("payment_due_date")
    .limit(30);
  if (error) return { error: error.message };
  return {
    today: todayIST,
    overdue: (data ?? []).map((r) => {
      const row = r as unknown as {
        installment_number: number; requested_amount: number; payment_due_date: string; status: string;
        request: { request_number: string; title: string | null; vendor: { name: string } | null };
      };
      return {
        number: shortRequestNumber(row.request.request_number),
        installment: row.installment_number,
        title: row.request.title,
        vendor: row.request.vendor?.name,
        amount: Number(row.requested_amount),
        due: row.payment_due_date,
        status: row.status,
      };
    }),
  };
}

async function spendByCategory(supabase: Supa) {
  const { data, error } = await supabase
    .from("request_line_items")
    .select(
      `amount, coa_account:coa_accounts(category),
       request:payment_requests!inner(installments:request_installments(status))`,
    )
    .limit(500);
  if (error) return { error: error.message };
  const truncated = (data?.length ?? 0) === 500;
  const spendStatuses = new Set(["approved", "uploaded_in_bank", "invoice_pending", "payment_processed", "closed"]);
  const totals = new Map<string, number>();
  for (const r of (data ?? []) as unknown as {
    amount: number;
    coa_account: { category: string } | null;
    request: { installments: { status: string }[] };
  }[]) {
    if (!r.request.installments.some((i) => spendStatuses.has(i.status))) continue;
    const cat = r.coa_account?.category ?? "Uncategorised";
    totals.set(cat, (totals.get(cat) ?? 0) + Number(r.amount));
  }
  return {
    note: truncated
      ? "PARTIAL DATA — only the first 500 line items were counted; totals are incomplete and you must say so."
      : "PO value of requests with at least one approved-or-later installment, by category",
    totals_are_partial: truncated,
    categories: [...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([category, total]) => ({ category, total })),
  };
}

async function listReadyToPay(supabase: Supa) {
  const { data, error } = await supabase
    .from("request_installments")
    .select(
      `installment_number, requested_amount,
       request:payment_requests!inner(request_number, title,
         vendor:vendors(name, status, bank_account_number, bank_ifsc))`,
    )
    .eq("status", "approved")
    .limit(100);
  if (error) return { error: error.message };
  type R = {
    installment_number: number; requested_amount: number;
    request: { request_number: string; title: string | null;
      vendor: { name: string; status: string; bank_account_number: string | null; bank_ifsc: string | null } | null };
  };
  const payable = [], heldBack = [];
  for (const r of (data ?? []) as unknown as R[]) {
    const v = r.request.vendor;
    const row = {
      number: shortRequestNumber(r.request.request_number),
      installment: r.installment_number,
      title: r.request.title,
      vendor: v?.name,
      amount: Number(r.requested_amount),
    };
    const ok = v?.status === "approved" && !!v.bank_account_number && !!v.bank_ifsc;
    if (ok) payable.push(row);
    else {
      heldBack.push({
        ...row,
        reason:
          v?.status !== "approved"
            ? "vendor not approved yet"
            : "vendor has no account number / IFSC",
      });
    }
  }
  return {
    payable,
    payable_total: payable.reduce((s, r) => s + r.amount, 0),
    held_back: heldBack,
    note: "Only the payable rows go into the Kotak bank file.",
  };
}

async function vendorStatus(supabase: Supa, vendorName: string) {
  const name = String(vendorName).replace(/[%_\\]/g, " ").trim();
  if (!name) return { error: "No vendor name given." };
  const { data, error } = await supabase
    .from("vendors")
    .select("name, status, gstin, pan, phone, bank_account_number, bank_ifsc, rejection_reason")
    .ilike("name", `%${name}%`)
    .limit(5);
  if (error) return { error: error.message };
  if (!data?.length) return { error: `No vendor matching "${name}".` };
  return {
    vendors: data.map((v) => {
      const missing: string[] = [];
      if (!v.phone) missing.push("mobile number");
      if (!v.bank_account_number) missing.push("bank account number");
      if (!v.bank_ifsc) missing.push("IFSC");
      return {
        name: v.name,
        status: v.status,
        gstin: v.gstin,
        pan: v.pan,
        has_bank_details: !!(v.bank_account_number && v.bank_ifsc),
        has_mobile: !!v.phone,
        missing_to_approve: missing,
        rejection_reason: v.rejection_reason,
        can_be_paid: v.status === "approved" && !!v.bank_account_number && !!v.bank_ifsc,
      };
    }),
  };
}

async function runTool(supabase: Supa, name: string, args: Record<string, unknown>) {
  try {
    switch (name) {
      case "list_my_requests": return await listMyRequests(supabase);
      case "list_pending_approvals": return await listPendingApprovals(supabase);
      case "get_request": return await getRequest(supabase, String(args.number ?? ""));
      case "vendor_payments": return await vendorPayments(supabase, String(args.vendor_name ?? ""));
      case "list_overdue": return await listOverdue(supabase);
      case "list_ready_to_pay": return await listReadyToPay(supabase);
      case "vendor_status": return await vendorStatus(supabase, String(args.vendor_name ?? ""));
      case "spend_by_category": return await spendByCategory(supabase);
      default: return { error: `Unknown tool ${name}` };
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Tool failed" };
  }
}

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
      } else if (res.status === 429) {
        friendly = "Ria is a bit busy right now (free-tier limit). Try again in a minute.";
      } else if (res.status === 401 || res.status === 403) {
        friendly =
          "The AI key isn't valid. An admin needs to set GEMINI_API_KEY in Vercel to a Google AI Studio key (starts with AIza) and redeploy.";
      } else if (res.status === 400) {
        friendly = "Ria couldn't process that request (code 400) — a setup issue, not your question.";
      } else if (res.status === 404) {
        friendly = "The AI model isn't available to this key (code 404). An admin should check the Gemini API is enabled for the key's project.";
      } else if (res.status === 429 && detail.includes("limit: 0")) {
        friendly = "This Gemini key has no request quota (free-tier limit is 0). An admin should create the key from Google AI Studio, or enable billing on its Google Cloud project.";
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
