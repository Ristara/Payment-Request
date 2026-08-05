import "server-only";

/**
 * WhatsApp notifications to vendors, via Meta's Cloud API directly.
 *
 * Direct rather than through a BSP: no middleman markup, and nothing between
 * this app and Meta that can change its pricing or its API on us.
 *
 * Two rules govern everything here.
 *
 * It NEVER throws. Telling a vendor their money has gone is worth doing, and
 * it is worth nothing compared to recording the payment itself. Every failure
 * — missing config, bad number, Meta down, token expired — comes back as a
 * value the caller stores and moves on from.
 *
 * It is INERT until configured. With no credentials it reports "not
 * configured" and sends nothing, so this can ship and sit dormant until the
 * Meta setup is finished.
 */

const GRAPH = "https://graph.facebook.com/v21.0";

export type WhatsAppResult =
  | { sent: true; messageId: string }
  | { sent: false; skipped: true; reason: string }
  | { sent: false; skipped: false; error: string };

function config() {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  // The template must exist and be APPROVED in Meta Business Manager before a
  // single message can go out; Meta rejects anything else outside a 24-hour
  // customer-service window, which a vendor we message first is never in.
  const template = process.env.WHATSAPP_PAYMENT_TEMPLATE ?? "payment_made";
  const language = process.env.WHATSAPP_TEMPLATE_LANG ?? "en";
  if (!token || !phoneNumberId) return null;
  return { token, phoneNumberId, template, language };
}

/**
 * A 10-digit Indian mobile to the digits Meta wants.
 *
 * Vendor numbers are stored bare — approveVendor strips +91, 91 and a leading
 * 0 before saving — so this adds the country code back rather than guessing
 * whether one is present. Anything that is not a plausible Indian mobile is
 * refused instead of being sent hopefully: a malformed number does not bounce,
 * it silently delivers to nobody, or worse, to somebody else.
 */
export function toWhatsAppNumber(raw: string | null | undefined): string | null {
  const digits = String(raw ?? "").replace(/\D/g, "");
  const ten = digits.length > 10 ? digits.slice(-10) : digits;
  if (ten.length !== 10 || !/^[6-9]/.test(ten)) return null;
  return `91${ten}`;
}

async function send(to: string, params: string[]): Promise<WhatsAppResult> {
  const cfg = config();
  if (!cfg) return { sent: false, skipped: true, reason: "WhatsApp is not configured." };

  try {
    // 12s: this runs inside recordPayment, and a hanging Meta must not hold
    // the accounts clerk's request open while their payment is already saved.
    const res = await fetch(`${GRAPH}/${cfg.phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: cfg.template,
          language: { code: cfg.language },
          components: [
            { type: "body", parameters: params.map((text) => ({ type: "text", text })) },
          ],
        },
      }),
      signal: AbortSignal.timeout(12_000),
    });

    const body = (await res.json().catch(() => ({}))) as {
      messages?: { id: string }[];
      error?: { message?: string; code?: number };
    };
    if (!res.ok) {
      const detail = body.error?.message ?? `HTTP ${res.status}`;
      return { sent: false, skipped: false, error: detail.slice(0, 300) };
    }
    const id = body.messages?.[0]?.id;
    return id
      ? { sent: true, messageId: id }
      : { sent: false, skipped: false, error: "Meta accepted the call but returned no message id." };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { sent: false, skipped: false, error: msg.slice(0, 300) };
  }
}

/**
 * "We have paid you, here is the UTR."
 *
 * The parameter order must match the approved template exactly — Meta fills
 * {{1}}, {{2}}, {{3}}, {{4}} positionally and has no idea what any of them
 * mean. Changing this order without changing the template in Meta Business
 * Manager sends the vendor an amount where the date should be.
 */
export async function notifyVendorOfPayment(opts: {
  phone: string | null | undefined;
  vendorName: string;
  amount: string;
  paymentDate: string;
  utr: string;
}): Promise<WhatsAppResult> {
  const to = toWhatsAppNumber(opts.phone);
  if (!to) return { sent: false, skipped: true, reason: "No usable mobile number on the vendor." };
  return send(to, [opts.vendorName, opts.amount, opts.paymentDate, opts.utr]);
}
