-- Radari fee payment automation setup
-- Run this in Supabase SQL Editor before deploying the Edge Functions.

alter table public.schools add column if not exists daraja_environment text default 'sandbox';
alter table public.schools add column if not exists fee_paybill text;
alter table public.schools add column if not exists fee_transaction_type text default 'CustomerPayBillOnline';
alter table public.schools add column if not exists fee_account_mode text default 'admission_number';
alter table public.schools add column if not exists fee_account_prefix text default '';
alter table public.schools add column if not exists fee_auto_allocate_excess boolean default true;
alter table public.schools add column if not exists fee_payment_instructions text;

alter table public.mpesa_payments add column if not exists fee_balance_id uuid references public.fee_balances(id) on delete set null;
alter table public.mpesa_payments add column if not exists checkout_request_id text;
alter table public.mpesa_payments add column if not exists merchant_request_id text;
alter table public.mpesa_payments add column if not exists account_reference text;
alter table public.mpesa_payments add column if not exists result_code text;
alter table public.mpesa_payments add column if not exists result_description text;
alter table public.mpesa_payments add column if not exists allocation_status text default 'pending';
alter table public.mpesa_payments add column if not exists excess_amount numeric default 0;
alter table public.mpesa_payments add column if not exists raw_callback jsonb;

create unique index if not exists mpesa_payments_checkout_unique
  on public.mpesa_payments(checkout_request_id)
  where checkout_request_id is not null;

create unique index if not exists mpesa_payments_ref_unique
  on public.mpesa_payments(mpesa_ref)
  where mpesa_ref is not null;

create table if not exists public.fee_credits (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references public.students(id) on delete cascade,
  school_id uuid references public.schools(id) on delete cascade,
  source_payment_id uuid references public.mpesa_payments(id) on delete set null,
  amount numeric not null default 0,
  remaining_amount numeric not null default 0,
  status text default 'open',
  notes text,
  created_at timestamptz default now()
);

grant all on public.fee_credits to authenticated;
