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

function env(name: string) {
  return String(Deno.env.get(name) || Deno.env.get(name.replace("SERVICE_", "DARAJA_")) || "").trim();
}

function timestamp() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function addDaysFromLater(currentPaidUntil: string | null, days = 30) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const current = currentPaidUntil ? new Date(`${currentPaidUntil}T00:00:00`) : today;
  const base = current > today ? current : today;
  base.setDate(base.getDate() + days);
  return base.toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, message: "Use POST" }, 405);

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace("Bearer ", "");
    const { school_id, checkout_request_id } = await req.json();
    if (!school_id) return json({ ok: false, message: "Missing school ID." }, 400);

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
      return json({ ok: false, message: "This account is not allowed to confirm that workspace." }, 403);
    }
    if (!["admin", "headteacher", "teacher"].includes(profile.role)) {
      return json({ ok: false, message: "Only school staff can confirm subscription payments." }, 403);
    }

    const { data: school } = await supabase
      .from("schools")
      .select("id,type,service_paid_until,service_lock_after_days,school_monthly_price,teacher_subscription_amount")
      .eq("id", school_id)
      .single();

    let payment: any = null;
    const checkoutId = String(checkout_request_id || "").trim();
    if (checkoutId) {
      const { data: byCheckout } = await supabase
        .from("service_subscription_payments")
        .select("*")
        .eq("checkout_request_id", checkoutId)
        .maybeSingle();
      payment = byCheckout || null;
      if (payment && payment.school_id !== school_id) {
        return json({ ok: false, message: "That payment request belongs to a different workspace." }, 403);
      }
    }

    if (!payment) {
      const { data: latest } = await supabase
        .from("service_subscription_payments")
        .select("*")
        .eq("school_id", school_id)
        .not("checkout_request_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      payment = latest || null;
    }

    if (!payment && checkoutId) {
      const isIndividual = String(school?.type || "").toLowerCase().includes("individual");
      const amount = Math.max(1, Math.round(Number(
        profile.role === "teacher" && isIndividual ? school?.teacher_subscription_amount || 450 : school?.school_monthly_price || 5500,
      )));
      const { data: rebuilt, error: rebuildErr } = await supabase
        .from("service_subscription_payments")
        .insert({
          school_id,
          user_id: profile.id,
          amount,
          subscription_months: 1,
          checkout_request_id: checkoutId,
          status: "pending",
          result_description: "Rebuilt during payment confirmation",
        })
        .select("*")
        .single();
      if (!rebuildErr) payment = rebuilt;
    }

    if (!payment) return json({ ok: false, message: "No subscription payment request found yet. Please click Pay again so Radari can receive a fresh M-Pesa checkout number." });

    if (payment.status === "completed" && payment.paid_until) {
      await supabase.from("schools").update({
        service_status: "active",
        service_paid_until: payment.paid_until,
        service_last_paid_at: payment.paid_at || new Date().toISOString(),
        service_last_receipt: payment.receipt_number || null,
      }).eq("id", school_id);
      return json({ ok: true, message: "Payment already confirmed.", paid_until: payment.paid_until });
    }

    const shortcode = env("SERVICE_SHORTCODE");
    const consumerKey = env("SERVICE_CONSUMER_KEY");
    const consumerSecret = env("SERVICE_CONSUMER_SECRET");
    const passkey = env("SERVICE_PASSKEY");
    const mode = (Deno.env.get("SERVICE_DARAJA_ENVIRONMENT") || "production").toLowerCase();

    if (!consumerKey || !consumerSecret || !passkey || !shortcode) {
      return json({ ok: false, message: "Service Daraja credentials are missing in Supabase secrets." });
    }

    const authUrl = mode === "sandbox"
      ? "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials"
      : "https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials";
    const queryUrl = mode === "sandbox"
      ? "https://sandbox.safaricom.co.ke/mpesa/stkpushquery/v1/query"
      : "https://api.safaricom.co.ke/mpesa/stkpushquery/v1/query";

    const oauthRes = await fetch(authUrl, {
      headers: { Authorization: `Basic ${btoa(`${consumerKey}:${consumerSecret}`)}` },
    });
    const oauth = await oauthRes.json();
    if (!oauthRes.ok || !oauth.access_token) {
      return json({ ok: false, message: oauth.errorMessage || oauth.error_description || "Daraja OAuth failed.", response: oauth });
    }

    const ts = timestamp();
    const queryPayload = {
      BusinessShortCode: Number(shortcode),
      Password: btoa(`${shortcode}${passkey}${ts}`),
      Timestamp: ts,
      CheckoutRequestID: payment.checkout_request_id,
    };

    const queryRes = await fetch(queryUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${oauth.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify(queryPayload),
    });
    const query = await queryRes.json();
    const resultCode = String(query.ResultCode ?? query.errorCode ?? "");
    const resultDesc = query.ResultDesc || query.ResponseDescription || query.errorMessage || "";

    if (!queryRes.ok || query.ResponseCode !== "0") {
      return json({ ok: false, message: resultDesc || "Daraja could not confirm this payment yet.", response: query });
    }

    if (resultCode !== "0") {
      const failedCodes = new Set(["1", "1032", "1037", "2001"]);
      if (failedCodes.has(resultCode)) {
        await supabase.from("service_subscription_payments").update({
          status: "failed",
          result_code: resultCode,
          result_description: resultDesc || "Payment was not completed.",
          raw_callback: query,
        }).eq("id", payment.id);
      }
      return json({ ok: false, message: resultDesc || "Payment has not completed yet.", response: query });
    }

    const months = Number(payment.subscription_months || 1);
    const days = months > 0 ? months * 30 : Number(school?.service_lock_after_days || 30);
    const paidUntil = addDaysFromLater(school?.service_paid_until || null, days);
    const paidAt = new Date().toISOString();
    const receipt = payment.receipt_number || `STK-${String(payment.checkout_request_id).slice(-10)}`;

    await supabase.from("service_subscription_payments").update({
      status: "completed",
      result_code: "0",
      result_description: resultDesc || "Success",
      paid_at: paidAt,
      paid_until: paidUntil,
      receipt_number: receipt,
      raw_callback: query,
    }).eq("id", payment.id);

    await supabase.from("schools").update({
      service_status: "active",
      service_paid_until: paidUntil,
      service_last_paid_at: paidAt,
      service_last_receipt: receipt,
    }).eq("id", school_id);

    return json({ ok: true, message: "Payment confirmed and subscription opened.", paid_until: paidUntil });
  } catch (error) {
    return json({ ok: false, message: error?.message || String(error) }, 500);
  }
});
