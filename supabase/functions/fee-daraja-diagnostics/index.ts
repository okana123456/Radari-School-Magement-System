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

function env(name: string, mode: string) {
  return Deno.env.get(`${name}_${mode.toUpperCase()}`) || Deno.env.get(name) || "";
}

function mask(value: string) {
  if (!value) return "missing";
  return `${value.slice(0, 4)}...${value.slice(-4)} (${value.length} chars)`;
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
    const mode = body.mode === "production" ? "production" : "sandbox";
    let phone = String(body.phone || "").replace(/\D/g, "");
    if (phone.startsWith("0")) phone = "254" + phone.slice(1);
    if (phone.startsWith("7") || phone.startsWith("1")) phone = "254" + phone;
    const shortcode = body.shortcode || env("DARAJA_SHORTCODE", mode);
    const consumerKey = env("DARAJA_CONSUMER_KEY", mode);
    const consumerSecret = env("DARAJA_CONSUMER_SECRET", mode);
    const passkey = env("DARAJA_PASSKEY", mode);
    const amount = Number(body.amount || 1);

    const report: any = {
      mode,
      secrets_seen: {
        DARAJA_CONSUMER_KEY: mask(consumerKey),
        DARAJA_CONSUMER_SECRET: mask(consumerSecret),
        DARAJA_PASSKEY: mask(passkey),
        DARAJA_SHORTCODE: mask(String(shortcode || "")),
      },
    };

    if (!consumerKey || !consumerSecret || !passkey || !shortcode) {
      return json({ ok: false, message: "Missing credentials.", report }, 500);
    }

    const authUrl = mode === "production"
      ? "https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials"
      : "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials";
    const stkUrl = mode === "production"
      ? "https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest"
      : "https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest";

    const oauthRes = await fetch(authUrl, {
      headers: { Authorization: `Basic ${btoa(`${consumerKey}:${consumerSecret}`)}` },
    });
    const oauth = await oauthRes.json();
    report.oauth = { ok: oauthRes.ok, status: oauthRes.status, response: oauth };
    if (!oauthRes.ok || !oauth.access_token) {
      return json({ ok: false, message: "OAuth failed.", report }, 502);
    }

    if (!phone) {
      return json({ ok: true, message: "OAuth works. Add phone to test STK.", report });
    }

    const ts = timestamp();
    const payload = {
      BusinessShortCode: Number(shortcode),
      Password: btoa(`${shortcode}${passkey}${ts}`),
      Timestamp: ts,
      TransactionType: body.transaction_type || "CustomerPayBillOnline",
      Amount: amount,
      PartyA: Number(phone),
      PartyB: Number(shortcode),
      PhoneNumber: Number(phone),
      CallBackURL: body.callback_url || "https://example.com/callback",
      AccountReference: body.account_reference || "RADARI",
      TransactionDesc: "Radari fee diagnostic",
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
      message: report.stk.ok ? "STK accepted. Daraja setup works." : "STK failed. Check response.",
      report,
    }, report.stk.ok ? 200 : 502);
  } catch (error) {
    return json({ ok: false, message: error?.message || String(error) }, 500);
  }
});
