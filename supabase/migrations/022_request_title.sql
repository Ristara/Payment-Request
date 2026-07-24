-- Human-readable title on payment request threads, shown in queues and on
-- the thread page. Nullable for legacy rows; required on new submissions at
-- the app layer.
alter table payment_requests add column if not exists title text;
