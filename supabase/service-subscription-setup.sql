-- Radari service subscription lock setup
-- Run this once in Supabase SQL Editor for the Radari project.

alter table public.schools
  add column if not exists service_started_on date default current_date,
  add column if not exists service_paid_until date default ((now() + interval '30 days')::date),
  add column if not exists service_status text default 'active',
  add column if not exists service_last_paid_at timestamptz,
  add column if not exists service_last_receipt text,
  add column if not exists service_lock_after_days int default 30;

do $$
begin
  alter table public.schools
    add constraint schools_service_status_check
    check (service_status in ('active','locked','trial','manual'))
    not valid;
exception
  when duplicate_object then null;
end $$;

create table if not exists public.service_subscription_payments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references public.schools(id) on delete cascade,
  user_id uuid references public.users(id) on delete set null,
  amount numeric not null default 0,
  subscription_months int default 1,
  phone text,
  checkout_request_id text,
  merchant_request_id text,
  receipt_number text,
  account_reference text,
  status text default 'pending',
  result_code text,
  result_description text,
  paid_at timestamptz,
  paid_until date,
  raw_callback jsonb,
  created_at timestamptz default now()
);

create unique index if not exists service_subscription_checkout_unique
  on public.service_subscription_payments(checkout_request_id)
  where checkout_request_id is not null;

alter table public.service_subscription_payments enable row level security;

drop policy if exists service_subscription_read_same_school on public.service_subscription_payments;
create policy service_subscription_read_same_school
on public.service_subscription_payments
for select
to authenticated
using (
  exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and u.school_id = service_subscription_payments.school_id
      and u.role in ('admin','headteacher','teacher')
  )
);

grant all on public.service_subscription_payments to authenticated, service_role;
