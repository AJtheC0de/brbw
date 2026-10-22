import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

type AdminClient = SupabaseClient<any, "public", "public", any, any>;
type InboundAddress = {
  id: string;
  alias_token: string;
  alias_slug: string | null;
  provider: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

const RESERVED_ALIASES = new Set([
  "abuse", "admin", "billing", "careers", "contact", "hello", "help", "info",
  "jobply", "jobs", "mail", "noreply", "no-reply", "postmaster", "privacy",
  "root", "security", "support", "system", "team", "track", "tracker",
]);
const ALIAS_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";

const defaultOrigins = [
  "https://brbw.vercel.app",
  "https://bewerbungen-tracker-driton.ajnunidriton.chatgpt.site",
  "http://127.0.0.1:5500",
  "http://localhost:5500",
];

function cleanDomain(value: string) {
  return value.trim().toLowerCase().replace(/^@/, "").replace(/\.$/, "");
}

function slugify(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
    .replace(/^[^a-z]+/, "").slice(0, 22);
}

function randomSuffix(length = 4) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (value) => ALIAS_ALPHABET[value % ALIAS_ALPHABET.length]).join("");
}

function aliasBase(user: { email?: string; user_metadata?: Record<string, unknown> }) {
  const metadata = user.user_metadata || {};
  const displayName = String(metadata.full_name || metadata.name || metadata.display_name || "").trim();
  const firstName = displayName.split(/\s+/)[0] || "";
  let base = slugify(firstName || String(user.email || "").split("@")[0] || "user");
  if (base.length < 3 || RESERVED_ALIASES.has(base)) base = "user";
  return base;
}

function requestedAlias(value: unknown) {
  if (typeof value !== "string") return "";
  const alias = value.trim().toLowerCase();
  if (!/^[a-z][a-z0-9-]{2,31}$/.test(alias) || RESERVED_ALIASES.has(alias)) return "";
  return alias;
}

async function createAddress(admin: AdminClient, user: { id: string; email?: string; user_metadata?: Record<string, unknown> }): Promise<InboundAddress> {
  const base = aliasBase(user);
  for (let attempt = 0; attempt < 8; attempt++) {
    const alias = `${base}-${randomSuffix()}`;
    const inserted = await admin.from("inbound_addresses")
      .insert({ user_id: user.id, alias_slug: alias, provider: "resend", enabled: false })
      .select("id, alias_token, alias_slug, provider, enabled, created_at, updated_at").single();
    if (!inserted.error) return inserted.data as InboundAddress;
    if (inserted.error.code !== "23505") throw inserted.error;
  }
  throw new Error("alias_generation_failed");
}

async function ensureAlias(admin: AdminClient, user: { id: string; email?: string; user_metadata?: Record<string, unknown> }, address: InboundAddress): Promise<InboundAddress> {
  if (typeof address.alias_slug === "string" && address.alias_slug) return address;
  const base = aliasBase(user);
  for (let attempt = 0; attempt < 8; attempt++) {
    const alias = `${base}-${randomSuffix()}`;
    const updated = await admin.from("inbound_addresses")
      .update({ alias_slug: alias, updated_at: new Date().toISOString() })
      .eq("id", address.id).eq("user_id", user.id)
      .select("id, alias_token, alias_slug, provider, enabled, created_at, updated_at").single();
    if (!updated.error) return updated.data as InboundAddress;
    if (updated.error.code !== "23505") throw updated.error;
  }
  throw new Error("alias_generation_failed");
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
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!authorization.toLowerCase().startsWith("bearer ")) return json(request, { ok: false, error: "not_authenticated" }, 401);
    if (!url || !key || !serviceKey) throw new Error("Supabase function environment is incomplete");
    const client = createClient(url, key, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await client.auth.getUser(authorization.slice(7).trim());
    if (authError || !authData.user) return json(request, { ok: false, error: "invalid_session" }, 401);
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

    const lookup = await admin
      .from("inbound_addresses")
      .select("id, alias_token, alias_slug, provider, enabled, created_at, updated_at")
      .eq("user_id", authData.user.id)
      .maybeSingle();
    if (lookup.error) throw lookup.error;
    let address = lookup.data as InboundAddress | null;
    if (!address) address = await createAddress(admin, authData.user);
    else address = await ensureAlias(admin, authData.user, address);

    const body = await request.json().catch(() => ({}));
    if (body.alias !== undefined) {
      const alias = requestedAlias(body.alias);
      if (!alias) return json(request, { ok: false, error: "invalid_alias", message: "Der Alias ist nicht erlaubt." }, 400);
      if (alias !== address.alias_slug) {
        const updated = await admin.from("inbound_addresses")
          .update({ alias_slug: alias, updated_at: new Date().toISOString() })
          .eq("id", address.id).eq("user_id", authData.user.id)
          .select("id, alias_token, alias_slug, provider, enabled, created_at, updated_at").single();
        if (updated.error?.code === "23505") return json(request, { ok: false, error: "alias_taken", message: "Diese Adresse ist bereits vergeben." }, 409);
        if (updated.error) throw updated.error;
        address = updated.data;
      }
    }
    if (body.enabled !== undefined) {
      if (typeof body.enabled !== "boolean") return json(request, { ok: false, error: "invalid_enabled" }, 400);
      const updated = await admin.from("inbound_addresses")
        .update({ enabled: body.enabled, updated_at: new Date().toISOString() })
        .eq("id", address.id).eq("user_id", authData.user.id)
        .select("id, alias_token, alias_slug, provider, enabled, created_at, updated_at").single();
      if (updated.error) throw updated.error;
      address = updated.data;
    }

    const domain = cleanDomain(Deno.env.get("RESEND_INBOUND_DOMAIN") || "");
    return json(request, {
      ok: true,
      data: {
        provider: address.provider,
        enabled: Boolean(address.enabled),
        alias: address.alias_slug,
        domain,
        email: domain ? `${address.alias_slug}@${domain}` : "",
        configured: Boolean(domain),
        webhookUrl: `${url}/functions/v1/inbound-email`,
      },
    });
  } catch (error) {
    console.error("Inbound settings failed", error);
    return json(request, { ok: false, error: "internal_error" }, 500);
  }
});
