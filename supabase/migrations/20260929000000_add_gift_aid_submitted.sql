-- Distinguish donations submitted by Gift Aided from historic claims imported
-- solely to provide a complete picture in charity insights.
alter table public.pending_uploaded_records
  add column if not exists gift_aid_submitted boolean not null default true;

alter table public.uploaded_records
  add column if not exists gift_aid_submitted boolean not null default true;

comment on column public.pending_uploaded_records.gift_aid_submitted is
  'True when Gift Aided submitted this donation to HMRC; false for imported historic claims.';

comment on column public.uploaded_records.gift_aid_submitted is
  'True when Gift Aided submitted this donation to HMRC; false for imported historic claims.';
