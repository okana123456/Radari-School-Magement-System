-- Radari school staff invitation setup
-- Run this once in Supabase SQL Editor before using "Invite staff login".

alter table public.teachers
add column if not exists user_id uuid references public.users(id) on delete set null;

grant select, insert, update on public.teachers to authenticated, service_role;
grant select, insert, update on public.users to authenticated, service_role;
grant select, update on public.teacher_device_sessions to authenticated, service_role;

drop policy if exists teacher_device_sessions_school_admin_reset on public.teacher_device_sessions;
create policy teacher_device_sessions_school_admin_reset
on public.teacher_device_sessions
for update
to authenticated
using (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.school_id = teacher_device_sessions.school_id
      and u.role in ('admin','headteacher')
  )
)
with check (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.school_id = teacher_device_sessions.school_id
      and u.role in ('admin','headteacher')
  )
);
