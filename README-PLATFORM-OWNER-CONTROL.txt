RADARI PLATFORM OWNER CONTROL

There is no default platform-owner password in the code.
Use your real Supabase/Auth account:

1. Sign up or sign in with your owner email.
2. If you forgot the password, use Forgot password on the login page.
3. The allowed owner emails are stored in:
   supabase/platform-owner-control-setup.sql


Run this SQL:

supabase/platform-owner-control-setup.sql


After that, the owner email will see:

Owner > Subscriptions


What you can control per school or individual teacher:

- Workspace ID
- Monthly price
- Paid-until date
- Lock or active status
- Add free days, for example 30 days
- Discount or owner note


What the owner dashboard shows:

- Total workspaces
- Active subscriptions
- Expired or locked subscriptions
- Schools
- Individual teacher workspaces
- Total users
- Total learners
- User signups this month
- Expected monthly revenue
- Subscription money collected this month


How to identify a customer:

Each school or individual teacher workspace shows an Owner ID.
Use that ID when a customer asks for a discount, free month, or custom price.


Recommended owner login:

Use your normal business email as the owner email.
Do not put a plain password inside the app code.
