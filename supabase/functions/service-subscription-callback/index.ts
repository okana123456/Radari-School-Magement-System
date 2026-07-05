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

function callbackValue(items: any[] = [], name: string) {
  return items.find((x) => x.Name === name)?.Value ?? null;
}

function parseMpesaDate(value: string | number | null) {
  const s = String(value || "");
  if (!/^\d{14}$/.test(s)) return new Date().toISOString();
  const iso = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14)}+03:00`;
  return new Date(iso).toISOString();
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
    const body = await req.json();
    const cb = body?.Body?.stkCallback || body?.stkCallback || {};
    const checkout = cb.CheckoutRequestID;
    const resultCode = String(cb.ResultCode ?? "");
    const resultDescription = cb.ResultDesc || cb.ResultDescription || "";
    const items = cb.CallbackMetadata?.Item || [];
    const amount = Number(callbackValue(items, "Amount") || 0);
    const receipt = callbackValue(items, "MpesaReceiptNumber");
    const transactionDate = callbackValue(items, "TransactionDate");
    const phone = callbackValue(items, "PhoneNumber");

    if (!checkout) return json({ ok: false, message: "Missing CheckoutRequestID" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: payment } = await supabase
      .from("service_subscription_payments")
      .select("*")
      .eq("checkout_request_id", checkout)
      .maybeSingle();

    if (!payment) return json({ ok: true, message: "Payment record not found yet; callback accepted." });

    if (resultCode !== "0") {
      await supabase.from("service_subscription_payments").update({
        status: "failed",
        result_code: resultCode,
        result_description: resultDescription,
        raw_callback: body,
      }).eq("id", payment.id);
      return json({ ok: true, message: "Failed subscription payment recorded." });
    }

    const { data: school } = await supabase
      .from("schools")
      .select("id,service_paid_until,service_lock_after_days")
      .eq("id", payment.school_id)
      .single();

    const paidUntil = addDaysFromLater(school?.service_paid_until || null, Number(school?.service_lock_after_days || 30));
    const paidAt = parseMpesaDate(transactionDate);

    await supabase.from("service_subscription_payments").update({
      amount: amount || payment.amount,
      phone: phone ? String(phone) : payment.phone,
      receipt_number: receipt,
      status: "completed",
      result_code: resultCode,
      result_description: resultDescription || "Success",
      paid_at: paidAt,
      paid_until: paidUntil,
      raw_callback: body,
    }).eq("id", payment.id);

    await supabase.from("schools").update({
      service_status: "active",
      service_paid_until: paidUntil,
      service_last_paid_at: paidAt,
      service_last_receipt: receipt,
    }).eq("id", payment.school_id);

    return json({ ok: true, message: "Subscription renewed.", paid_until: paidUntil });
  } catch (error) {
    return json({ ok: false, message: error?.message || String(error) }, 500);
  }
});

