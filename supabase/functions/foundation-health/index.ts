import { requireUser } from "../_shared/auth.ts";
import { corsHeaders, handleError, handleOptions, json } from "../_shared/http.ts";
import { enforceRateLimit } from "../_shared/rate-limit.ts";

Deno.serve(async (request) => {
  try {
    if (request.method === "OPTIONS") return handleOptions(request);
    corsHeaders(request);
    if (request.method !== "GET") return json(request, { ok: false, error: "method_not_allowed" }, 405);

    const { user, client } = await requireUser(request);
    const limit = await enforceRateLimit(client, "foundation-health", 30, 60);
    return json(request, {
      ok: true,
      schemaVersion: "2026-10-22",
      userId: user.id,
      rateLimit: { remaining: limit.remaining, resetAt: limit.reset_at },
      capabilities: {
        magicImport: true,
        aiPreparation: false,
        inboundEmail: false,
      },
    });
  } catch (error) {
    return handleError(request, error);
  }
});
