const DEFAULT_ORIGINS = [
  "https://bewerbungen-tracker-driton.ajnunidriton.chatgpt.site",
  "https://brbw.vercel.app",
];

export class HttpError extends Error {
  constructor(public status: number, message: string, public code = "request_failed") {
    super(message);
  }
}

function allowedOrigins() {
  const configured = (Deno.env.get("ALLOWED_ORIGINS") || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return new Set([...DEFAULT_ORIGINS, ...configured]);
}

function isDevelopmentOrigin(origin: string) {
  try {
    const url = new URL(origin);
    return ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

export function corsHeaders(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && !allowedOrigins().has(origin) && !isDevelopmentOrigin(origin)) {
    throw new HttpError(403, "Origin is not allowed", "origin_not_allowed");
  }
  return {
    "Access-Control-Allow-Origin": origin || DEFAULT_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

export function json(request: Request, body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { ...corsHeaders(request), "Cache-Control": "no-store" },
  });
}

export function handleError(request: Request, error: unknown) {
  const known = error instanceof HttpError;
  if (!known) console.error("Unhandled function error", error);
  if (known && error.code === "origin_not_allowed") {
    return Response.json({ ok: false, error: error.code, message: error.message }, { status: error.status });
  }
  return json(request, {
    ok: false,
    error: known ? error.code : "internal_error",
    message: known ? error.message : "Internal server error",
  }, known ? error.status : 500);
}

export function handleOptions(request: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}
