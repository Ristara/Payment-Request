-- Payment kind on the thread: regular payments vs milestone-linked
-- payments (e.g. construction stage releases). Nullable for legacy rows;
-- required on new submissions at the app layer.

do $$ begin
  create type payment_kind as enum ('regular', 'milestone');
exception when duplicate_object then null; end $$;

alter table payment_requests
  add column if not exists payment_kind payment_kind;
