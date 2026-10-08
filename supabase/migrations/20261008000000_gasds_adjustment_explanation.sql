-- Required for editing GASDS corrections independently of repayment adjustments.
alter table public.gasds_claims
  add column if not exists adjustment numeric(12, 2),
  add column if not exists adjustment_explanation text;

-- Preserve optional spreadsheet sponsored-event indicators.
alter table public.donations add column if not exists sponsored boolean not null default false;
alter table public.uploaded_records add column if not exists sponsored boolean not null default false;
alter table public.pending_uploaded_records add column if not exists sponsored boolean not null default false;
