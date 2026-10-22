import { createClient } from "npm:@supabase/supabase-js@2";

const defaultOrigins = [
  "https://brbw.vercel.app",
  "https://bewerbungen-tracker-driton.ajnunidriton.chatgpt.site",
  "http://127.0.0.1:5500",
  "http://localhost:5500",
];

function cleanDomain(value: string) {
  return value.trim().toLowerCase().replace(/^@/, "").replace(/\.$/, "");
}

function headers(request: Request) {
  const origin = request.headers.get("origin") || "";
  const configured = (Deno.env.get("ALLOWED_ORIGINS") || "").split(",").map((item) => item.trim()).filter(Boolean);
  const allowed = new Set([...defaultOrigins, ...configured]);
  return {
    "Access-Control-Allow-Origin": allowed.has(origin) ? origin : defaultOrigins[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    Vary: "Origin",
  };
}

function json(request: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: headers(request) });
}

Deno.serve(async (request) => {
  try {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: headers(request) });
    if (request.method !== "POST") return json(request, { ok: false, error: "method_not_allowed" }, 405);

    const authorization = request.headers.get("authorization") || "";
    const url = Deno.env.get("SUPABASE_URL") || "";
    const key = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";
    if (!authorization.toLowerCase().startsWith("bearer ")) return json(request, { ok: false, error: "not_authenticated" }, 401);
    if (!url || !key) throw new Error("Supabase function environment is incomplete");
    const client = createClient(url, key, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await client.auth.getUser(authorization.slice(7).trim());
    if (authError || !authData.user) return json(request, { ok: false, error: "invalid_session" }, 401);

    let { data: address, error } = await client
      .from("inbound_addresses")
      .select("id, alias_token, provider, enabled, created_at, updated_at")
      .eq("user_id", authData.user.id)
      .maybeSingle();
    if (error) throw error;
    if (!address) {
      const inserted = await client.from("inbound_addresses")
        .insert({ user_id: authData.user.id, provider: "resend", enabled: false })
        .select("id, alias_token, provider, enabled, created_at, updated_at").single();
      if (inserted.error) throw inserted.error;
      address = inserted.data;
    }

    const body = await request.json().catch(() => ({}));
    if (body.enabled !== undefined) {
      if (typeof body.enabled !== "boolean") return json(request, { ok: false, error: "invalid_enabled" }, 400);
      const updated = await client.from("inbound_addresses")
        .update({ enabled: body.enabled, updated_at: new Date().toISOString() })
        .eq("id", address.id).eq("user_id", authData.user.id)
        .select("id, alias_token, provider, enabled, created_at, updated_at").single();
      if (updated.error) throw updated.error;
      address = updated.data;
    }

    const domain = cleanDomain(Deno.env.get("RESEND_INBOUND_DOMAIN") || "");
    const prefix = (Deno.env.get("INBOUND_ADDRESS_PREFIX") || "track-").replace(/[^a-z0-9-]/gi, "").slice(0, 24);
    return json(request, {
      ok: true,
      data: {
        provider: address.provider,
        enabled: Boolean(address.enabled),
        email: domain ? `${prefix}${address.alias_token}@${domain}` : "",
        configured: Boolean(domain),
        webhookUrl: `${url}/functions/v1/inbound-email`,
      },
    });
  } catch (error) {
    console.error("Inbound settings failed", error);
    return json(request, { ok: false, error: "internal_error" }, 500);
  }
});
