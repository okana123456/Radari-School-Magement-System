-- Radari platform owner control setup
-- Run this in Supabase SQL Editor.
-- It allows the platform owner to manage subscription price, lock status,
-- discounts, and free months for every school or individual teacher workspace.

create table if not exists public.platform_owner_emails (
  email text primary key,
  created_at timestamptz default now()
);

insert into public.platform_owner_emails (email)
values
  ('brucedataanalytics@gmail.com'),
  ('rudderresearch@gmail.com')
on conflict (email) do nothing;

alter table public.schools
  add column if not exists service_customer_code text,
  add column if not exists service_discount_note text;

update public.schools
set service_customer_code = upper(substr(replace(id::text, '-', ''), 1, 8))
where service_customer_code is null;

create unique index if not exists schools_service_customer_code_unique
on public.schools(service_customer_code)
where service_customer_code is not null;

create or replace function public.is_platform_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.platform_owner_emails p
    where lower(p.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  )
$$;

grant select on public.platform_owner_emails to authenticated;
grant all on public.schools to authenticated;

drop policy if exists schools_platform_owner_update on public.schools;
create policy schools_platform_owner_update
on public.schools
for update
to authenticated
using (public.is_platform_owner())
with check (public.is_platform_owner());

drop policy if exists service_subscription_platform_owner_read on public.service_subscription_payments;
create policy service_subscription_platform_owner_read
on public.service_subscription_payments
for select
to authenticated
using (public.is_platform_owner());

