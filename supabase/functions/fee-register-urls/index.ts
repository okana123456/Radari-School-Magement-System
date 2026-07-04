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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, message: "Use POST" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const mode = body.mode === "production" ? "production" : "sandbox";
    const shortcode = body.shortcode || env("DARAJA_SHORTCODE", mode);
    const consumerKey = env("DARAJA_CONSUMER_KEY", mode);
    const consumerSecret = env("DARAJA_CONSUMER_SECRET", mode);
    const responseType = body.response_type || "Completed";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const validationUrl = body.validation_url || `${supabaseUrl}/functions/v1/fee-payment-validation`;
    const confirmationUrl = body.confirmation_url || `${supabaseUrl}/functions/v1/fee-payment-callback`;

    if (!shortcode || !consumerKey || !consumerSecret) {
      return json({ ok: false, message: "Shortcode or Daraja consumer credentials are missing." }, 500);
    }

    const authUrl = mode === "production"
      ? "https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials"
      : "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials";
    const registerUrl = mode === "production"
      ? "https://api.safaricom.co.ke/mpesa/c2b/v1/registerurl"
      : "https://sandbox.safaricom.co.ke/mpesa/c2b/v1/registerurl";

    const oauthRes = await fetch(authUrl, {
      headers: { Authorization: `Basic ${btoa(`${consumerKey}:${consumerSecret}`)}` },
    });
    const oauth = await oauthRes.json();
    if (!oauthRes.ok || !oauth.access_token) {
      return json({ ok: false, message: "Daraja OAuth failed.", oauth }, 502);
    }

    const payload = {
      ShortCode: String(shortcode),
      ResponseType: responseType,
      ConfirmationURL: confirmationUrl,
      ValidationURL: validationUrl,
    };

    const registerRes = await fetch(registerUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${oauth.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const response = await registerRes.json();

    return json({
      ok: registerRes.ok,
      message: registerRes.ok ? "C2B URLs registered." : "C2B URL registration failed.",
      sent: payload,
      response,
    }, registerRes.ok ? 200 : 502);
  } catch (error) {
    return json({ ok: false, message: error?.message || String(error) }, 500);
  }
});
