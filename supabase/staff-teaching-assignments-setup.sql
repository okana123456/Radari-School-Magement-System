-- Radari staff teaching assignments setup
-- Run this once in Supabase SQL Editor.

alter table public.teachers
add column if not exists system_role text default 'teacher';

alter table public.teachers
add column if not exists subjects_taught text;

alter table public.teachers
add column if not exists classes_taught text;

alter table public.teachers
add column if not exists streams_taught text;

alter table public.teachers
add column if not exists is_class_teacher boolean default false;

alter table public.teachers
add column if not exists class_teacher_grade text;

alter table public.teachers
add column if not exists class_teacher_stream text;

grant select, insert, update on public.teachers to authenticated, service_role;
