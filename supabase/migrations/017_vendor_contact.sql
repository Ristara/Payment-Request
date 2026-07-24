-- Vendor contact details: mobile number (mandatory for NEW vendors — the
-- 80+ legacy imports have none, so the column stays nullable and Accounts
-- collects it at approval time, same pattern as bank details) and an
-- optional email.

alter table vendors
  add column if not exists phone text,
  add column if not exists email text;
