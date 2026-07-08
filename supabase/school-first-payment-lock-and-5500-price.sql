-- Radari school first-payment lock and KSh 5,500 default
-- Run this in Supabase SQL Editor.
-- It makes newly registered full schools pay before first access.

alter table public.schools
alter column school_monthly_price set default 5500;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  _school uuid;
  _role app_role;
  _signup_type text;
  _school_name text;
begin
  _signup_type := coalesce(new.raw_user_meta_data->>'signup_type', 'join_school');
  _school_name := nullif(trim(coalesce(new.raw_user_meta_data->>'school_name', '')), '');

  if _signup_type = 'school_owner' then
    insert into public.schools (name, type, service_paid_until, service_status, school_monthly_price)
    values (coalesce(_school_name, 'New School'), 'School', null, 'locked', 5500)
    returning id into _school;
    _role := 'admin';

  elsif _signup_type = 'individual_teacher' then
    insert into public.schools (name, type, service_paid_until, service_status)
    values (
      coalesce(_school_name, coalesce(new.raw_user_meta_data->>'full_name', 'Teacher') || ' Workspace'),
      'Individual teacher',
      null,
      'locked'
    )
    returning id into _school;
    _role := 'teacher';

  else
    select id into _school
    from public.schools
    where school_code = new.raw_user_meta_data->>'school_code';
    _role := coalesce((new.raw_user_meta_data->>'role')::app_role, 'parent');
  end if;

  insert into public.users (id, school_id, full_name, email, phone, role)
  values (
    new.id,
    _school,
    new.raw_user_meta_data->>'full_name',
    new.email,
    new.raw_user_meta_data->>'phone',
    _role
  );

  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- Lock unpaid full-school workspaces that were created before this change.
update public.schools
set service_paid_until = null,
    service_status = 'locked',
    school_monthly_price = 5500
where lower(coalesce(type, '')) = 'school'
  and service_last_paid_at is null
  and lower(coalesce(service_status, 'active')) not in ('trial', 'manual');

-- Keep individual-teacher workspaces locked before first payment as before.
update public.schools
set service_paid_until = null,
    service_status = 'locked'
where lower(coalesce(type, '')) like '%individual%'
  and service_last_paid_at is null
  and lower(coalesce(service_status, 'active')) not in ('trial', 'manual');
