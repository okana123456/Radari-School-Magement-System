-- Radari platform owner subscription bypass
-- Run this if your operator/platform owner account gets locked by the normal school subscription rule.

update public.schools s
set service_status = 'manual',
    service_paid_until = coalesce(service_paid_until, (now() + interval '10 years')::date)
where exists (
  select 1
  from public.users u
  where u.school_id = s.id
    and lower(u.email) in ('brucedataanalytics@gmail.com', 'rudderresearch@gmail.com')
);
