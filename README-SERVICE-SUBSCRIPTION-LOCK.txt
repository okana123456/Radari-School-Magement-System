RADARI SERVICE SUBSCRIPTION LOCK

This is for your own monthly Radari subscription money.
It is separate from school fee payments made by parents.


1. RUN THIS SQL

supabase/service-subscription-setup.sql

This adds:
- service_paid_until on schools
- service_status on schools
- service_subscription_payments table

By default, a school gets 30 days from the date the SQL is run.


2. DEPLOY THESE EDGE FUNCTIONS

start-service-subscription-payment
service-subscription-callback
service-daraja-diagnostics


3. ADD THESE SUPABASE EDGE FUNCTION SECRETS

SERVICE_CONSUMER_KEY
SERVICE_CONSUMER_SECRET
SERVICE_PASSKEY
SERVICE_SHORTCODE

Optional:

SERVICE_DARAJA_ENVIRONMENT = production
SERVICE_TRANSACTION_TYPE = CustomerPayBillOnline

If you already added DARAJA_* secrets, the service functions can fall back to them,
but SERVICE_* is better because it keeps your subscription payment setup separate
from school fee payment setup.


4. HOW IT WORKS

- Radari checks the school's service_paid_until date whenever a user logs in.
- If the date is still valid, the system opens normally.
- If the date is near expiry, the user sees a reminder.
- If the date has expired, a full-screen payment blanket appears.
- Admin, headteacher, or teacher can enter a Safaricom number and pay.
- After successful payment, service-subscription-callback extends access by 30 days.


5. TEST FIRST

Call service-daraja-diagnostics with:

{
  "phone": "2547XXXXXXXX",
  "amount": 1,
  "mode": "production"
}

If it says STK accepted, the credentials are correct.

