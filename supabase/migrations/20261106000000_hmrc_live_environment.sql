-- Adds an explicit HMRC transport environment so test and live claims can
-- never be confused. Existing/recognition submissions remain test by default.
alter table if exists public.submissions
  add column if not exists hmrc_environment text not null default 'test';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'submissions_hmrc_environment_check'
  ) then
    alter table public.submissions
      add constraint submissions_hmrc_environment_check
      check (hmrc_environment in ('test', 'live'));
  end if;
end $$;

comment on column public.submissions.hmrc_environment is
  'HMRC Transaction Engine target for this exact built claim: test (ETS) or live.';
