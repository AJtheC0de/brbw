import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export type VerifiedSessionClaims = {
  sessionId: string;
  issuedAt: string;
};

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  return atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
}
export function sessionClaims(request: Request): VerifiedSessionClaims | null {
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.toLowerCase().startsWith("bearer ")) return null;
  try {
    const token = authorization.slice(7).trim();
    const payload = JSON.parse(decodeBase64Url(token.split(".")[1] || "")) as Record<string, unknown>;
    const sessionId = String(payload.session_id || "");
    const issuedAt = Number(payload.iat);
    if (!/^[0-9a-f-]{36}$/i.test(sessionId) || !Number.isFinite(issuedAt) || issuedAt <= 0) return null;
    return { sessionId, issuedAt: new Date(issuedAt * 1000).toISOString() };
  } catch {
    return null;
  }
}

export async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function idempotencyKey(request: Request) {
  const key = (request.headers.get("x-idempotency-key") || "").trim();
  return key.length >= 16 && key.length <= 128 ? key : "";
}

export async function assertActiveSession(
  admin: SupabaseClient,
  request: Request,
  userId: string,
) {
  const claims = sessionClaims(request);
  if (!claims) return false;
  const { data, error } = await admin.rpc("assert_active_session", {
    target_user_id: userId,
    target_session_id: claims.sessionId,
    token_issued_at: claims.issuedAt,
  });
  if (error) throw new Error(`Session security check failed: ${error.message}`);
  return data === true;
}
