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

function accountReference(student: any, school: any) {
  const prefix = school.fee_account_prefix || "";
  const base = school.fee_account_mode === "student_id"
    ? student.id
    : (student.admission_number || student.id);
  return `${prefix}${base}`.slice(0, 12);
}

function darajaEnv(name: string, mode: string) {
  return Deno.env.get(`${name}_${mode.toUpperCase()}`) || Deno.env.get(name) || "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, message: "Use POST" }, 405);

  try {
    const { fee_balance_id, student_id, phone, amount } = await req.json();
    const cleanPhone = normalizePhone(phone);
    if (!/^254(7|1)\d{8}$/.test(cleanPhone)) {
      return json({ ok: false, message: "Invalid Safaricom phone number." }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const { data:balance, error:balErr } = await supabase
      .from("fee_balances")
      .select("*, students(*), schools(*)")
      .eq("id", fee_balance_id)
      .eq("student_id", student_id)
      .single();
    if (balErr || !balance) return json({ ok: false, message: "Fee balance was not found." }, 404);

    const school = balance.schools || {};
    const student = balance.students || {};
    const paybill = school.fee_paybill || darajaEnv("DARAJA_SHORTCODE", school.daraja_environment || "sandbox");
    const mode = school.daraja_environment === "production" ? "production" : "sandbox";
    const consumerKey = darajaEnv("DARAJA_CONSUMER_KEY", mode);
    const consumerSecret = darajaEnv("DARAJA_CONSUMER_SECRET", mode);
    const passkey = darajaEnv("DARAJA_PASSKEY", mode);
    const transactionType = school.fee_transaction_type || "CustomerPayBillOnline";
    const requestedAmount = Math.max(1, Math.round(Number(amount || balance.balance || 0)));

    if (!consumerKey || !consumerSecret || !passkey || !paybill) {
      return json({ ok: false, message: "Daraja credentials or paybill are missing." }, 500);
    }

    const authUrl = mode === "production"
      ? "https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials"
      : "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials";
    const stkUrl = mode === "production"
      ? "https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest"
      : "https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest";

    const auth = btoa(`${consumerKey}:${consumerSecret}`);
    const oauthRes = await fetch(authUrl, { headers: { Authorization: `Basic ${auth}` } });
    const oauth = await oauthRes.json();
    if (!oauthRes.ok || !oauth.access_token) {
      return json({ ok: false, message: "Daraja OAuth failed.", oauth }, 502);
    }

    const ts = timestamp();
    const password = btoa(`${paybill}${passkey}${ts}`);
    const callbackUrl = Deno.env.get("FEE_CALLBACK_URL") || `${supabaseUrl}/functions/v1/fee-payment-callback`;
    const account = accountReference(student, school);

    const payload = {
      BusinessShortCode: Number(paybill),
      Password: password,
      Timestamp: ts,
      TransactionType: transactionType,
      Amount: requestedAmount,
      PartyA: Number(cleanPhone),
      PartyB: Number(paybill),
      PhoneNumber: Number(cleanPhone),
      CallBackURL: callbackUrl,
      AccountReference: account,
      TransactionDesc: `${school.name || "School"} fees`,
    };

    const stkRes = await fetch(stkUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${oauth.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const stk = await stkRes.json();
    if (!stkRes.ok || stk.ResponseCode !== "0") {
      return json({ ok: false, message: "STK request failed.", response: stk }, 502);
    }

    await supabase.from("mpesa_payments").upsert({
      student_id,
      school_id: balance.school_id,
      fee_balance_id,
      amount: requestedAmount,
      phone_number: cleanPhone,
      checkout_request_id: stk.CheckoutRequestID,
      merchant_request_id: stk.MerchantRequestID,
      account_reference: account,
      status: "pending",
      allocation_status: "pending",
      result_description: stk.ResponseDescription,
    }, { onConflict: "checkout_request_id" });

    return json({
      ok: true,
      message: "M-Pesa prompt sent.",
      checkout_request_id: stk.CheckoutRequestID,
      customer_message: stk.CustomerMessage,
    });
  } catch (error) {
    return json({ ok: false, message: error?.message || String(error) }, 500);
  }
});
