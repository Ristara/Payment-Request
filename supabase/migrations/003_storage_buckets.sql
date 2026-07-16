-- ============================================================================
-- Storage buckets for attachments and vendor docs.
-- Private buckets — access only via signed URLs generated on the server.
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('request-attachments', 'request-attachments', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('vendor-docs', 'vendor-docs', false)
on conflict (id) do nothing;

-- Storage RLS — we let authenticated users upload and read via signed URLs.
-- (The server signs URLs with the admin client, so end users never touch
-- storage directly with their JWT.)

drop policy if exists "attachments_upload_authenticated" on storage.objects;
create policy "attachments_upload_authenticated" on storage.objects
  for insert to authenticated
  with check (bucket_id in ('request-attachments', 'vendor-docs'));

drop policy if exists "attachments_read_authenticated" on storage.objects;
create policy "attachments_read_authenticated" on storage.objects
  for select to authenticated
  using (bucket_id in ('request-attachments', 'vendor-docs'));
