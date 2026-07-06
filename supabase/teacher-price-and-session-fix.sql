-- Fix individual teacher monthly price and device-session conflicts.
-- Run this in Supabase SQL Editor.

alter table public.schools
alter column teacher_subscription_amount set default 450;

-- Existing individual-teacher workspaces created when the old default was 300
-- should now use 450, unless you have already changed them to another price.
update public.schools
set teacher_subscription_amount = 450
where lower(coalesce(type, '')) like '%individual%'
  and coalesce(teacher_subscription_amount, 0) in (0, 300)
  and service_last_paid_at is null;

-- Make sure the browser/device record can be safely reactivated on the same browser.
create unique index if not exists teacher_device_sessions_user_browser_unique
on public.teacher_device_sessions(user_id, browser_id);

grant select, insert, update on public.teacher_device_sessions to authenticated;
