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
  return Deno.env.get(name) || Deno.env.get(name.replace("SERVICE_", "DARAJA_")) || "";
}

function mask(value: string) {
  if (!value) return "missing";
  return `${value.slice(0, 4)}...${value.slice(-4)} (${value.length} chars)`;
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, message: "Use POST" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const mode = (body.mode || Deno.env.get("SERVICE_DARAJA_ENVIRONMENT") || "production").toLowerCase();
    const phone = normalizePhone(body.phone || "");
    const amount = Number(body.amount || 1);
    const shortcode = body.shortcode || env("SERVICE_SHORTCODE");
    const consumerKey = env("SERVICE_CONSUMER_KEY");
    const consumerSecret = env("SERVICE_CONSUMER_SECRET");
    const passkey = env("SERVICE_PASSKEY");

    const report: any = {
      mode,
      secrets_seen: {
        SERVICE_CONSUMER_KEY: mask(consumerKey),
        SERVICE_CONSUMER_SECRET: mask(consumerSecret),
        SERVICE_PASSKEY: mask(passkey),
        SERVICE_SHORTCODE: mask(String(shortcode || "")),
      },
    };

    if (!consumerKey || !consumerSecret || !passkey || !shortcode) {
      return json({ ok: false, message: "Missing service credentials.", report }, 500);
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
    report.oauth = { ok: oauthRes.ok, status: oauthRes.status, response: oauth };
    if (!oauthRes.ok || !oauth.access_token) {
      return json({ ok: false, message: "OAuth failed.", report }, 502);
    }

    if (!phone) return json({ ok: true, message: "OAuth works. Add phone to test STK.", report });

    const ts = timestamp();
    const payload = {
      BusinessShortCode: Number(shortcode),
      Password: btoa(`${shortcode}${passkey}${ts}`),
      Timestamp: ts,
      TransactionType: body.transaction_type || Deno.env.get("SERVICE_TRANSACTION_TYPE") || "CustomerPayBillOnline",
      Amount: amount,
      PartyA: Number(phone),
      PartyB: Number(shortcode),
      PhoneNumber: Number(phone),
      CallBackURL: body.callback_url || "https://example.com/callback",
      AccountReference: body.account_reference || "RADARI",
      TransactionDesc: "Radari subscription diagnostic",
    };

    const stkRes = await fetch(stkUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${oauth.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const stk = await stkRes.json();
    report.stk = {
      ok: stkRes.ok && stk.ResponseCode === "0",
      status: stkRes.status,
      response: stk,
      sent_without_password: { ...payload, Password: "[hidden]" },
    };

    return json({
      ok: report.stk.ok,
      message: report.stk.ok ? "STK accepted. Service subscription Daraja setup works." : "STK failed. Check response.",
      report,
    }, report.stk.ok ? 200 : 502);
  } catch (error) {
    return json({ ok: false, message: error?.message || String(error) }, 500);
  }
});

