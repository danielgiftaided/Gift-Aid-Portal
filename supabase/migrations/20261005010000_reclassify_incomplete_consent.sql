-- Preserve consent separately from completeness. Reclassify reporting rows;
-- existing donations and previously submitted HMRC claims are not changed.

update public.uploaded_records
set record_status = 'incomplete'
where nullif(btrim(first_name), '') is null
    or nullif(btrim(last_name), '') is null
    or nullif(btrim(address), '') is null
    or nullif(btrim(postcode), '') is null
    or nullif(btrim(donation_date::text), '') is null
    or amount is null or amount <= 0;

update public.uploaded_records
set record_status = 'opt_out'
where not (nullif(btrim(first_name), '') is null
    or nullif(btrim(last_name), '') is null
    or nullif(btrim(address), '') is null
    or nullif(btrim(postcode), '') is null
    or nullif(btrim(donation_date::text), '') is null
    or amount is null or amount <= 0)
  and upper(btrim(coalesce(gift_aid_opt_in, ''))) in ('', 'N', 'NO');

update public.pending_uploaded_records
set record_status = 'incomplete'
where nullif(btrim(first_name), '') is null
    or nullif(btrim(last_name), '') is null
    or nullif(btrim(address), '') is null
    or nullif(btrim(postcode), '') is null
    or nullif(btrim(donation_date::text), '') is null
    or amount is null or amount <= 0;

update public.pending_uploaded_records
set record_status = 'opt_out'
where not (nullif(btrim(first_name), '') is null
    or nullif(btrim(last_name), '') is null
    or nullif(btrim(address), '') is null
    or nullif(btrim(postcode), '') is null
    or nullif(btrim(donation_date::text), '') is null
    or amount is null or amount <= 0)
  and upper(btrim(coalesce(gift_aid_opt_in, ''))) in ('', 'N', 'NO');
