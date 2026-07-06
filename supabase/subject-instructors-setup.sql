-- Subject instructor setup for report cards
-- Run this once in Supabase SQL Editor before using instructor names in the Subjects tab.

alter table public.cbc_strands
add column if not exists teacher_id uuid references public.teachers(id) on delete set null;

alter table public.cbc_strands
add column if not exists instructor_name text;
