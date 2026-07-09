-- Radari finance role setup
-- Run this once in Supabase SQL Editor before inviting a Finance officer.

alter type app_role add value if not exists 'finance';

-- Finance staff need to read and update fee records for their own school.
-- Existing school-wide RLS policies already use public.has_school_access(school_id),
-- so adding the enum value is the important missing database step.

