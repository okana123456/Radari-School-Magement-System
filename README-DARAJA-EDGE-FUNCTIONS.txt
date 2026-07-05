RADARI DARAJA EDGE FUNCTIONS

Deploy these Supabase Edge Functions:

1. start-fee-payment
   - Used when the school/parent clicks Pay via M-Pesa from the system.
   - Sends the STK prompt.

2. fee-payment-callback
   - Used by Safaricom after STK payment succeeds or fails.
   - Also handles normal Paybill payments where the parent pays manually using admission number as account reference.
   - This is the Confirmation URL.

3. fee-payment-validation
   - Used by Safaricom C2B validation.
   - This is the Validation URL.

4. fee-register-urls
   - Helper to register the validation and confirmation URLs with Daraja.

5. fee-daraja-diagnostics
   - Test helper like the one we used in the other systems.
   - It checks OAuth and can send a test STK prompt without touching the student fee records.


SUPABASE EDGE FUNCTION SECRETS

Add these in Supabase > Edge Functions > Secrets:

DARAJA_CONSUMER_KEY
DARAJA_CONSUMER_SECRET
DARAJA_PASSKEY
DARAJA_SHORTCODE

Optional sandbox/production separated names are also supported:

DARAJA_CONSUMER_KEY_SANDBOX
DARAJA_CONSUMER_SECRET_SANDBOX
DARAJA_PASSKEY_SANDBOX
DARAJA_SHORTCODE_SANDBOX

DARAJA_CONSUMER_KEY_PRODUCTION
DARAJA_CONSUMER_SECRET_PRODUCTION
DARAJA_PASSKEY_PRODUCTION
DARAJA_SHORTCODE_PRODUCTION

Also make sure these default Supabase secrets exist:

SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY


WHERE TO SET SCHOOL PAYMENT MODE

In Radari Settings, set:

Daraja mode: sandbox or production
Paybill / Shortcode: your school paybill
Account mode: admission number is recommended
Account prefix: optional


IMPORTANT

For normal school fees, a parent can pay directly by Paybill and admission number.
They do not need an STK prompt.

The STK prompt is only an extra convenience button inside the system.

