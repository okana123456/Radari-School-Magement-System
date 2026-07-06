import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, prefer",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizePhone(phone: string) {
  let p = String(phone || "").replace(/\D/g, "");
  if (p.startsWith("0")) p = "254" + p.slice(1);
  if (p.startsWith("7") || p.startsWith("1")) p = "254" + p;
  return p;
}

function timestamp() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function env(name: string) {
  return Deno.env.get(name) || Deno.env.get(name.replace("SERVICE_", "DARAJA_")) || "";
}

function accountReference(school: any) {
  const code = String(school.school_code || school.id || "RADARI").replace(/[^a-z0-9]/gi, "").toUpperCase();
  return `RDR${code}`.slice(0, 12);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, message: "Use POST" }, 405);

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace("Bearer ", "");
    const { school_id, phone, months } = await req.json();
    const cleanPhone = normalizePhone(phone);
    if (!/^254(7|1)\d{8}$/.test(cleanPhone)) {
      return json({ ok: false, message: "Invalid Safaricom phone number." }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const { data: userRes } = await supabase.auth.getUser(jwt);
    const user = userRes?.user;
    if (!user) return json({ ok: false, message: "Not signed in." }, 401);

    const { data: profile } = await supabase
      .from("users")
      .select("id,school_id,role")
      .eq("id", user.id)
      .maybeSingle();
    if (!profile || profile.school_id !== school_id) {
      return json({ ok: false, message: "This account is not allowed to renew that school." }, 403);
    }
    if (!["admin", "headteacher", "teacher"].includes(profile.role)) {
      return json({ ok: false, message: "Only school staff can renew the subscription." }, 403);
    }

    const { data: school, error: schoolErr } = await supabase
      .from("schools")
      .select("*")
      .eq("id", school_id)
      .single();
    if (schoolErr || !school) return json({ ok: false, message: "School not found." }, 404);

    const requestedMonths = [1, 3, 6, 12].includes(Number(months)) ? Number(months) : 1;
    const monthly = Math.max(1, Math.round(Number(
      profile.role === "teacher" ? school.teacher_subscription_amount || 450 : school.school_monthly_price || 3000,
    )));
    const discount = requestedMonths >= 12 ? 0.8 : requestedMonths >= 6 ? 0.85 : requestedMonths >= 3 ? 0.9 : 1;
    const amount = Math.max(1, Math.round(monthly * requestedMonths * discount));

    const shortcode = env("SERVICE_SHORTCODE");
    const consumerKey = env("SERVICE_CONSUMER_KEY");
    const consumerSecret = env("SERVICE_CONSUMER_SECRET");
    const passkey = env("SERVICE_PASSKEY");
    const transactionType = Deno.env.get("SERVICE_TRANSACTION_TYPE") || "CustomerPayBillOnline";
    const mode = (Deno.env.get("SERVICE_DARAJA_ENVIRONMENT") || "production").toLowerCase();

    if (!consumerKey || !consumerSecret || !passkey || !shortcode) {
      return json({
        ok: false,
        message: "Service Daraja credentials are missing. Check SERVICE_CONSUMER_KEY, SERVICE_CONSUMER_SECRET, SERVICE_PASSKEY and SERVICE_SHORTCODE in Supabase secrets.",
      });
    }

    const authUrl = mode === "sandbox"
      ? "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials"
      : "https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials";
    const stkUrl = mode === "sandbox"
      ? "https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest"
      : "https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest";

    const oauthRes = await fetch(authUrl, {
      headers: { Authorization: `Basic ${btoa(`${consumerKey}:${consumerSecret}`)}` },
    });
    const oauth = await oauthRes.json();
    if (!oauthRes.ok || !oauth.access_token) {
      return json({
        ok: false,
        message: oauth.errorMessage || oauth.error_description || "Daraja OAuth failed. Check consumer key and consumer secret.",
        response: oauth,
      });
    }

    const ts = timestamp();
    const account = accountReference(school);
    const callbackUrl = Deno.env.get("SERVICE_CALLBACK_URL") || `${supabaseUrl}/functions/v1/service-subscription-callback`;
    const payload = {
      BusinessShortCode: Number(shortcode),
      Password: btoa(`${shortcode}${passkey}${ts}`),
      Timestamp: ts,
      TransactionType: transactionType,
      Amount: amount,
      PartyA: Number(cleanPhone),
      PartyB: Number(shortcode),
      PhoneNumber: Number(cleanPhone),
      CallBackURL: callbackUrl,
      AccountReference: account,
      TransactionDesc: "Radari subscription",
    };

    const stkRes = await fetch(stkUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${oauth.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const stk = await stkRes.json();
    if (!stkRes.ok || stk.ResponseCode !== "0") {
      return json({
        ok: false,
        message: stk.errorMessage || stk.ResponseDescription || "STK request failed. Check shortcode, passkey and transaction type.",
        response: stk,
      });
    }

    await supabase.from("service_subscription_payments").upsert({
      school_id,
      user_id: profile.id,
      amount,
      subscription_months: requestedMonths,
      phone: cleanPhone,
      checkout_request_id: stk.CheckoutRequestID,
      merchant_request_id: stk.MerchantRequestID,
      account_reference: account,
      status: "pending",
      result_description: stk.ResponseDescription,
    }, { onConflict: "checkout_request_id" });

    return json({
      ok: true,
      message: "Subscription payment prompt sent.",
      amount,
      months: requestedMonths,
      checkout_request_id: stk.CheckoutRequestID,
      customer_message: stk.CustomerMessage,
    });
  } catch (error) {
    return json({ ok: false, message: error?.message || String(error) }, 500);
  }
});
