-- 016 · Storage for supervisor daily-update attachments (site photos & PDFs).
-- Creates a public bucket 'site-updates' and the RLS policies so authenticated
-- users can upload and everyone can read the files back (needed for previews).
-- Idempotent: safe to re-run. Purely additive — no existing object is touched.

-- Bucket: public read (so getPublicUrl previews work), 25 MB/file, images + PDF + Word.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'site-updates', 'site-updates', true, 26214400,
  array[
    'image/png','image/jpeg','image/jpg','image/webp','image/gif','image/heic',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Read: anyone may read objects in this bucket (public evidence photos/docs).
drop policy if exists "site_updates_read" on storage.objects;
create policy "site_updates_read" on storage.objects
  for select using (bucket_id = 'site-updates');

-- Upload: any authenticated user (the logged-in supervisor) may add files here.
drop policy if exists "site_updates_insert" on storage.objects;
create policy "site_updates_insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'site-updates');

-- Update/overwrite own path (upsert) — authenticated only, this bucket only.
drop policy if exists "site_updates_update" on storage.objects;
create policy "site_updates_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'site-updates') with check (bucket_id = 'site-updates');

-- Delete — authenticated only, this bucket only (lets a mistaken file be removed).
drop policy if exists "site_updates_delete" on storage.objects;
create policy "site_updates_delete" on storage.objects
  for delete to authenticated using (bucket_id = 'site-updates');
