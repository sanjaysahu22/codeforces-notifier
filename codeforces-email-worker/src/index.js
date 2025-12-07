// worker.js (Cloudflare Worker)
addEventListener("fetch", event => {
  event.respondWith(handle(event.request));
});

async function handle(request) {
  if (request.method !== "POST") {
    return new Response("Use POST", { status: 405 });
  }

  const origin = request.headers.get("Origin") || "*";
  // Simple CORS allowance for dev; in production restrict to your extension or domain
  const corsHeaders = {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: "invalid json" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...corsHeaders }
    });
  }

  const { to, subject, html, text, contestId } = body;
  if (!to || !subject || (!html && !text)) {
    return new Response(JSON.stringify({ error: "missing fields" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...corsHeaders }
    });
  }

  // Prevent obvious abuse — e.g., limit length
  if (to.length > 254 || (subject && subject.length > 200)) {
    return new Response(JSON.stringify({ error: "field too long" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...corsHeaders }
    });
  }

  // Build Resend request
  const API_KEY = __ENV.RESEND_API_KEY; // set in Cloudflare worker secrets
  const payload = {
    from: "Codeforces Notifier <onboarding@resend.dev>", // or your verified/sender domain
    to: [to],
    subject,
    html: html || `<pre>${escapeHtml(text)}</pre>`
  };

  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`
      },
      body: JSON.stringify(payload)
    });

    const data = await resp.json();
    return new Response(JSON.stringify({ ok: true, data }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders }
    });
  }
}

function escapeHtml(s = "") {
  return s.replace(/[&<>"']/g, (m) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m]));
}

