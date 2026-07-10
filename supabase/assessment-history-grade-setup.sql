-- Radari assessment history upgrade
-- Run this once in Supabase SQL Editor.
-- It lets Radari remember the grade/class where a result was recorded,
-- so a learner's progress can be reviewed across years, for example Grade 4 to Grade 8.

alter table public.assessments
  add column if not exists grade_recorded text;

create index if not exists idx_assessments_student_year_term
  on public.assessments (student_id, year, term);

create index if not exists idx_assessments_grade_recorded
  on public.assessments (grade_recorded, year, term);
