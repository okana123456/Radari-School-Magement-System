-- Radari professional upgrade: business controls and teacher device policy

alter table public.schools add column if not exists teacher_subscription_amount numeric default 300;
alter table public.schools add column if not exists school_monthly_price numeric default 3000;
alter table public.schools add column if not exists teacher_device_policy text default 'one_browser';
alter table public.schools add column if not exists parent_access_mode text default 'login_required';

create table if not exists public.teacher_device_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade,
  school_id uuid references public.schools(id) on delete cascade,
  browser_id text not null,
  device_label text,
  status text default 'active',
  first_seen timestamptz default now(),
  last_seen timestamptz default now(),
  unique(user_id, browser_id)
);

grant all on public.teacher_device_sessions to authenticated;
