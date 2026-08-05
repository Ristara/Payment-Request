-- Record whether the vendor was actually told about a payment.
--
-- Without this, WhatsApp is a fire-and-forget side effect: a wrong number, an
-- expired token or a template Meta has paused all look identical from inside
-- the app — the payment records fine and nobody learns the vendor was never
-- notified until they ring up asking where the money is. That is precisely the
-- class of silent failure this project keeps being bitten by.
--
-- Nullable and with no default on purpose: a NULL sent_at with a NULL error
-- means "not attempted", which is the honest state for every payment recorded
-- before this existed, and for every one recorded while WhatsApp is switched
-- off.

alter table public.payment_records
  add column if not exists whatsapp_sent_at timestamptz,
  add column if not exists whatsapp_error text;

comment on column public.payment_records.whatsapp_sent_at is
  'When Meta accepted the payment notification for delivery. NULL = never attempted, or attempted and failed (see whatsapp_error).';

comment on column public.payment_records.whatsapp_error is
  'Why the vendor was not notified. NULL alongside a NULL sent_at means it was never attempted.';
