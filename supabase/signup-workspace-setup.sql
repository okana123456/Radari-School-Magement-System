-- Radari signup workspace setup
-- Run this in Supabase SQL Editor after the main Radari SQL.
-- It lets the signup page support:
-- 1. joining an existing school with a school code
-- 2. registering a whole school
-- 3. registering as an individual teacher

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
    insert into public.schools (name, type)
    values (coalesce(_school_name, 'New School'), 'School')
    returning id into _school;
    _role := 'admin';

  elsif _signup_type = 'individual_teacher' then
    insert into public.schools (name, type)
    values (
      coalesce(_school_name, coalesce(new.raw_user_meta_data->>'full_name', 'Teacher') || ' Workspace'),
      'Individual teacher'
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

