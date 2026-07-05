RADARI SIGNUP AND ADMIN VISIBILITY

Signup now has three choices:

1. Join an existing school
   - Used by teachers and parents who already have a school code.
   - They are attached to the existing school.

2. Register a school
   - Used by a school owner, headteacher, director, or admin.
   - A new school workspace is created.
   - The first user becomes admin.

3. Individual teacher
   - Used by one teacher buying Radari alone.
   - A personal teacher workspace is created.
   - The user becomes a teacher.
   - This should use the KSh 300 monthly subscription path.


Run this SQL for the new signup flow:

supabase/signup-workspace-setup.sql


Normal school admins will not see your Radari business pricing controls.
Those are only shown to the platform-owner emails inside index.html:

brucedataanalytics@gmail.com
rudderresearch@gmail.com

You can change those emails in the Settings module if needed.

