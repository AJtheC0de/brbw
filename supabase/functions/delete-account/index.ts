import { createClient } from "npm:@supabase/supabase-js@2";

const DEFAULT_ORIGINS = [
  "https://brbw.vercel.app",
  "http://127.0.0.1:5500",
  "http://localhost:5500",
];

class HttpError extends Error {
  constructor(public status: number, message: string, public code: string) { super(message); }
}

function corsHeaders(request: Request) {
  const origin = request.headers.get("origin") || "";
  const configured = (Deno.env.get("ALLOWED_ORIGINS") || "")
    .split(",").map((value) => value.trim()).filter(Boolean);
  const allowed = new Set([...DEFAULT_ORIGINS, ...configured]);
  if (origin && !allowed.has(origin)) throw new HttpError(403, "Origin is not allowed", "origin_not_allowed");
  return {
    "Access-Control-Allow-Origin": origin || DEFAULT_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Vary": "Origin",
  };
}

function json(request: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(request) });
}

Deno.serve(async (request) => {
  try {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request) });
    if (request.method !== "POST") throw new HttpError(405, "Method not allowed", "method_not_allowed");

    const authorization = request.headers.get("authorization") || "";
    if (!authorization.toLowerCase().startsWith("bearer ")) {
      throw new HttpError(401, "Authentication required", "not_authenticated");
    }
    const body = await request.json().catch(() => ({}));
    const action = body?.action;
    if (action === "delete-account" && body?.confirmation !== "LÖSCHEN") throw new HttpError(400, "Confirmation is required", "confirmation_required");
    if (action === "delete-data" && body?.confirmation !== "ALLE DATEN LÖSCHEN") throw new HttpError(400, "Confirmation is required", "confirmation_required");
    if (action !== "delete-account" && action !== "delete-data") throw new HttpError(400, "Action is invalid", "invalid_action");

    const url = Deno.env.get("SUPABASE_URL") || "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!url || !anonKey || !serviceKey) throw new Error("Supabase function environment is incomplete");

    const token = authorization.slice(7).trim();
    const authClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await authClient.auth.getUser(token);
    if (authError || !authData.user) throw new HttpError(401, "Session is invalid", "invalid_session");

    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    // The target ID is derived exclusively from the verified JWT. No client ID
    // is accepted, preventing cross-tenant deletion.
    const { data: cvFiles, error: cvListError } = await admin.storage.from("private-cvs").list(`${authData.user.id}/cv`, { limit: 100 });
    if (cvListError && cvListError.message !== "Bucket not found") throw cvListError;
    const cvPaths = (cvFiles || []).map((file) => `${authData.user.id}/cv/${file.name}`);
    if (cvPaths.length) {
      const { error: cvDeleteError } = await admin.storage.from("private-cvs").remove(cvPaths);
      if (cvDeleteError) throw cvDeleteError;
    }
    if (action === "delete-data") {
      const tables = [
        "inbound_messages", "automation_suggestions", "application_ai_artifacts",
        "interviews", "applications", "inbound_addresses", "automation_runs", "rate_limit_buckets",
        "user_profiles",
      ];
      for (const table of tables) {
        const { error } = await admin.from(table).delete().eq("user_id", authData.user.id);
        if (error) throw error;
      }
    } else {
      const { error: deleteError } = await admin.auth.admin.deleteUser(authData.user.id, false);
      if (deleteError) throw deleteError;
    }
    return json(request, { ok: true });
  } catch (error) {
    const known = error instanceof HttpError;
    if (!known) console.error(JSON.stringify({ event: "delete_account_failed", code: "internal_error" }));
    try {
      return json(request, {
        ok: false,
        error: known ? error.code : "internal_error",
        message: known ? error.message : "Account could not be deleted",
      }, known ? error.status : 500);
    } catch {
      return Response.json({ ok: false, error: "origin_not_allowed" }, { status: 403 });
    }
  }
});
