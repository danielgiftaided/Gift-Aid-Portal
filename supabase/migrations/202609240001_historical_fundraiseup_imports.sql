alter table public.uploaded_records
  add column if not exists gift_aid_submitted boolean not null default false;