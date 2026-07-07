-- Radari report-card colour settings
-- Run once in Supabase SQL Editor.

alter table public.schools
  add column if not exists report_primary_color text default '#1a3c2a',
  add column if not exists report_accent_color text default '#e8f5e9';

update public.schools
set
  report_primary_color = coalesce(report_primary_color, '#1a3c2a'),
  report_accent_color = coalesce(report_accent_color, '#e8f5e9');
