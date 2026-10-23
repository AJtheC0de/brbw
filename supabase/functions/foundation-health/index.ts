import { createClient } from "npm:@supabase/supabase-js@2";

const DEFAULT_ORIGINS = ["https://bewerbungen-tracker-driton.ajnunidriton.chatgpt.site", "https://brbw.vercel.app"];

class HttpError extends Error {
  constructor(public status: number, message: string, public code = "request_failed") { super(message); }
}

function corsHeaders(request: Request) {
  const origin = request.headers.get("origin");
  const configured = (Deno.env.get("ALLOWED_ORIGINS") || "").split(",").map((value) => value.trim()).filter(Boolean);
  const allowed = new Set([...DEFAULT_ORIGINS, ...configured]);
  let development = false;
  try { development = ["localhost", "127.0.0.1", "::1"].includes(new URL(origin || "").hostname); } catch { /* Invalid origins are rejected below. */ }
  if (origin && !allowed.has(origin) && !development) throw new HttpError(403, "Origin is not allowed", "origin_not_allowed");
  return {
    "Access-Control-Allow-Origin": origin || DEFAULT_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Max-Age": "86400", "Cache-Control": "no-store", "Vary": "Origin",
  };
}

function json(request: Request, body: unknown, status = 200) {
  return Response.json(body, { status, headers: corsHeaders(request) });
}

Deno.serve(async (request) => {
  try {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request) });
    corsHeaders(request);
    if (request.method !== "GET") return json(request, { ok: false, error: "method_not_allowed" }, 405);

    const authorization = request.headers.get("authorization") || "";
    if (!authorization.toLowerCase().startsWith("bearer ")) throw new HttpError(401, "Authentication required", "not_authenticated");
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
    if (!url || !key) throw new Error("Supabase function environment is incomplete");
    const client = createClient(url, key, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await client.auth.getUser(authorization.slice(7).trim());
    if (authError || !authData.user) throw new HttpError(401, "Session is invalid or expired", "invalid_session");
    const { data, error } = await client.rpc("consume_rate_limit", { bucket_name: "foundation-health" });
    if (error) throw new Error(`Rate limit check failed: ${error.message}`);
    const limit = data?.[0];
    if (!limit?.allowed) throw new HttpError(429, "Too many requests. Please try again later.", "rate_limited");
    return json(request, {
      ok: true,
      schemaVersion: "2026-10-23",
      userId: authData.user.id,
      rateLimit: { remaining: limit.remaining, resetAt: limit.reset_at },
      capabilities: {
        magicImport: true,
        aiPreparation: false,
        inboundEmail: true,
      },
    });
  } catch (error) {
    const known = error instanceof HttpError;
    if (!known) console.error(JSON.stringify({ event: "foundation_health_failed", code: "internal_error" }));
    try {
      return json(request, {
        ok: false,
        error: known ? error.code : "internal_error",
        message: known ? error.message : "Internal server error",
      }, known ? error.status : 500);
    } catch {
      return Response.json({ ok: false, error: "origin_not_allowed" }, { status: 403 });
    }
  }
});
