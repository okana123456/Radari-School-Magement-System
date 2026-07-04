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

function callbackAccepted(message = "Accepted") {
  return json({ ResultCode: 0, ResultDesc: message, ok: true, message });
}

function cleanAccountRef(value: string | null | undefined) {
  return String(value || "").trim();
}

function stripPrefix(account: string, prefix = "") {
  if (!prefix) return account;
  return account.toLowerCase().startsWith(prefix.toLowerCase())
    ? account.slice(prefix.length)
    : account;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function allocatePayment(supabase: any, payment: any, amount: number) {
  let remaining = amount;
  let allocated = 0;

  const { data:firstBalance } = await supabase
    .from("fee_balances")
    .select("id,student_id,school_id,term,year,amount_due,amount_paid,balance")
    .eq("id", payment.fee_balance_id)
    .maybeSingle();

  const balances: any[] = [];
  if (firstBalance) balances.push(firstBalance);

  const { data:otherBalances = [] } = await supabase
    .from("fee_balances")
    .select("id,student_id,school_id,term,year,amount_due,amount_paid,balance")
    .eq("student_id", payment.student_id)
    .gt("balance", 0)
    .neq("id", payment.fee_balance_id || "00000000-0000-0000-0000-000000000000")
    .order("year", { ascending: true })
    .order("term", { ascending: true });
  balances.push(...otherBalances);

  for (const bal of balances) {
    if (remaining <= 0) break;
    const dueNow = Math.max(0, Number(bal.amount_due || 0) - Number(bal.amount_paid || 0));
    if (dueNow <= 0) continue;
    const use = Math.min(remaining, dueNow);
    const newPaid = Number(bal.amount_paid || 0) + use;
    await supabase.from("fee_balances").update({ amount_paid: newPaid }).eq("id", bal.id);
    remaining -= use;
    allocated += use;
  }

  if (remaining > 0) {
    const { data:school } = await supabase
      .from("schools")
      .select("fee_auto_allocate_excess")
      .eq("id", payment.school_id)
      .maybeSingle();

    await supabase.from("fee_credits").insert({
      student_id: payment.student_id,
      school_id: payment.school_id,
      source_payment_id: payment.id,
      amount: remaining,
      remaining_amount: remaining,
      status: school?.fee_auto_allocate_excess === false ? "manual" : "open",
      notes: school?.fee_auto_allocate_excess === false
        ? "Overpayment waiting for manual allocation"
        : "Overpayment carried forward for the next fee balance",
    });
  }

  return { allocated, excess: remaining };
}

async function findManualPaybillStudent(supabase: any, shortcode: string, accountRef: string) {
  const { data:schools = [] } = await supabase
    .from("schools")
    .select("id,name,fee_paybill,fee_account_mode,fee_account_prefix")
    .eq("fee_paybill", shortcode);

  for (const school of schools) {
    const stripped = stripPrefix(accountRef, school.fee_account_prefix || "");
    let query = supabase
      .from("students")
      .select("id,school_id,full_name,admission_number")
      .eq("school_id", school.id)
      .eq("admission_number", stripped)
      .maybeSingle();

    let { data:student } = await query;
    if (!student && isUuid(stripped)) {
      const byId = await supabase
        .from("students")
        .select("id,school_id,full_name,admission_number")
        .eq("school_id", school.id)
        .eq("id", stripped)
        .maybeSingle();
      student = byId.data;
    }

    if (student) return { school, student, normalizedAccount: stripped };
  }

  return { school: schools[0] || null, student: null, normalizedAccount: accountRef };
}

async function firstOpenBalance(supabase: any, studentId: string) {
  const { data } = await supabase
    .from("fee_balances")
    .select("id,student_id,school_id,term,year,amount_due,amount_paid,balance")
    .eq("student_id", studentId)
    .gt("balance", 0)
    .order("year", { ascending: true })
    .order("term", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data || null;
}

async function handleManualPaybillCallback(supabase: any, body: any) {
  const receipt = body.TransID || body.trans_id || body.TransactionID;
  const shortcode = String(body.BusinessShortCode || body.BusinessShortcode || body.ShortCode || "");
  const accountRef = cleanAccountRef(body.BillRefNumber || body.AccountReference || body.bill_ref_number);
  const amount = Number(body.TransAmount || body.Amount || 0);
  const phone = body.MSISDN || body.PhoneNumber || body.phone;
  const transactionDate = parseMpesaDate(body.TransTime || body.TransactionDate || null);

  if (!receipt) return callbackAccepted("Missing receipt accepted for review");

  const { data:existing } = await supabase
    .from("mpesa_payments")
    .select("id,allocation_status")
    .eq("mpesa_ref", receipt)
    .maybeSingle();
  if (existing) return callbackAccepted("Duplicate receipt ignored");

  const match = await findManualPaybillStudent(supabase, shortcode, accountRef);

  if (!match.student) {
    await supabase.from("mpesa_payments").insert({
      school_id: match.school?.id || null,
      mpesa_ref: receipt,
      amount,
      phone_number: phone ? String(phone) : null,
      payment_date: transactionDate,
      account_reference: accountRef,
      status: "completed",
      allocation_status: "unmatched",
      result_code: "0",
      result_description: `Manual Paybill received but account reference ${accountRef || "(blank)"} did not match a learner.`,
      raw_callback: body,
    });
    return callbackAccepted("Payment received but unmatched");
  }

  const balance = await firstOpenBalance(supabase, match.student.id);
  const { data:payment, error:insertError } = await supabase
    .from("mpesa_payments")
    .insert({
      student_id: match.student.id,
      school_id: match.student.school_id,
      fee_balance_id: balance?.id || null,
      mpesa_ref: receipt,
      amount,
      phone_number: phone ? String(phone) : null,
      payment_date: transactionDate,
      account_reference: accountRef,
      status: "completed",
      allocation_status: "pending",
      result_code: "0",
      result_description: "Manual Paybill payment received",
      raw_callback: body,
    })
    .select("*")
    .single();

  if (insertError || !payment) return callbackAccepted("Payment received; insert failed for review");

  const allocation = await allocatePayment(supabase, payment, amount);
  await supabase.from("mpesa_payments").update({
    allocation_status: allocation.excess > 0 ? "allocated_with_credit" : "allocated",
    excess_amount: allocation.excess,
    result_description: allocation.allocated > 0
      ? "Manual Paybill payment allocated"
      : "Manual Paybill payment saved as credit",
  }).eq("id", payment.id);

  return callbackAccepted("Manual Paybill payment allocated");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, message: "Use POST" }, 405);

  try {
    const body = await req.json();
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    if (body?.TransID || body?.BillRefNumber || body?.BusinessShortCode) {
      return await handleManualPaybillCallback(supabase, body);
    }

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

    const { data:payment } = await supabase
      .from("mpesa_payments")
      .select("*")
      .eq("checkout_request_id", checkout)
      .maybeSingle();

    if (!payment) return json({ ok: true, message: "Payment record not found yet; callback accepted." });

    if (resultCode !== "0") {
      await supabase.from("mpesa_payments").update({
        status: "failed",
        allocation_status: "failed",
        result_code: resultCode,
        result_description: resultDescription,
        raw_callback: body,
      }).eq("id", payment.id);
      return json({ ok: true, message: "Failed payment recorded." });
    }

    const allocation = await allocatePayment(supabase, payment, amount);

    await supabase.from("mpesa_payments").update({
      mpesa_ref: receipt,
      amount,
      phone_number: phone ? String(phone) : payment.phone_number,
      payment_date: parseMpesaDate(transactionDate),
      status: "completed",
      allocation_status: allocation.excess > 0 ? "allocated_with_credit" : "allocated",
      result_code: resultCode,
      result_description: resultDescription || "Success",
      excess_amount: allocation.excess,
      raw_callback: body,
    }).eq("id", payment.id);

    return json({ ok: true, message: "Fee payment allocated.", allocation });
  } catch (error) {
    return json({ ok: false, message: error?.message || String(error) }, 500);
  }
});
