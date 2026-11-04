import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { idempotencyKey, sessionClaims, sha256Hex } from "./security.ts";

export type AiReservation = {
  id: string;
  premium: boolean;
  remaining: number | null;
  dispatched: boolean;
};

export class AiQuotaError extends Error {
  status = 402;
  code = "ai_quota_exceeded";
  constructor() {
    super("Deine drei kostenlosen KI-Nutzungen sind aufgebraucht.");
  }
}

export class AiSecurityError extends Error {
  constructor(public status: number, message: string, public code: string) {
    super(message);
  }
}

type ReservationOptions = {
  request?: Request;
  operationKey?: string;
  payload: unknown;
  estimatedUnits: number;
  requireActiveSession?: boolean;
};

export function adminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Supabase service environment is incomplete");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function reserveAiUsage(
  admin: SupabaseClient,
  userId: string,
  feature: string,
  options: ReservationOptions,
): Promise<AiReservation> {
  const requireActiveSession = options.requireActiveSession !== false;
  const claims = options.request ? sessionClaims(options.request) : null;
  const operationKey = options.operationKey || (options.request ? idempotencyKey(options.request) : "");
  if (!operationKey) {
    throw new AiSecurityError(400, "Idempotency key is required", "idempotency_key_required");
  }
  if (requireActiveSession && !claims) {
    throw new AiSecurityError(401, "Session is invalid or expired", "invalid_session");
  }
  const payloadHash = await sha256Hex(JSON.stringify(options.payload));
  const { data, error } = await admin.rpc("reserve_ai_operation", {
    target_user_id: userId,
    feature_name: feature,
    operation_key: operationKey,
    operation_payload_hash: payloadHash,
    estimated_cost_units: Math.max(1, Math.min(100_000, Math.trunc(options.estimatedUnits))),
    require_active_session: requireActiveSession,
    target_session_id: claims?.sessionId || null,
    token_issued_at: claims?.issuedAt || null,
  });
  if (error?.code === "23505") {
    throw new AiSecurityError(409, "Es läuft bereits eine KI-Verarbeitung.", "ai_operation_in_progress");
  }
  if (error) throw new Error(`AI quota check failed: ${error.message}`);
  const row = data?.[0] as {
    allowed?: boolean;
    reservation_id?: string | null;
    is_premium?: boolean;
    remaining?: number | null;
    denial_reason?: string | null;
  } | undefined;
  if (!row?.allowed || !row.reservation_id) {
    switch (row?.denial_reason) {
      case "free_quota_exhausted": throw new AiQuotaError();
      case "daily_quota_exhausted":
      case "burst_quota_exhausted":
        throw new AiSecurityError(429, "KI-Limit erreicht. Bitte versuche es später erneut.", "ai_rate_limited");
      case "service_disabled":
      case "service_budget_exhausted":
        throw new AiSecurityError(503, "KI-Funktionen sind vorübergehend deaktiviert.", "ai_temporarily_disabled");
      case "session_revoked":
        throw new AiSecurityError(401, "Die Sitzung wurde beendet.", "session_revoked");
      case "account_blocked":
        throw new AiSecurityError(403, "Der Account ist vorübergehend gesperrt.", "account_blocked");
      case "idempotency_conflict":
        throw new AiSecurityError(409, "Der Vorgangsschlüssel wurde bereits anders verwendet.", "idempotency_conflict");
      default:
        if (row?.denial_reason?.startsWith("duplicate_")) {
          throw new AiSecurityError(409, "Dieser Vorgang wurde bereits verarbeitet.", "operation_already_processed");
        }
        throw new AiSecurityError(503, "KI-Freigabe konnte nicht geprüft werden.", "ai_reservation_failed");
    }
  }
  return {
    id: row.reservation_id,
    premium: Boolean(row.is_premium),
    remaining: row.remaining ?? null,
    dispatched: false,
  };
}

export async function markAiDispatched(admin: SupabaseClient, reservation: AiReservation) {
  const { error } = await admin.rpc("mark_ai_operation_dispatched", { reservation: reservation.id });
  if (error) throw new Error(`AI dispatch could not be recorded: ${error.message}`);
  reservation.dispatched = true;
}

export function openAiUsageUnits(payload: Record<string, unknown>) {
  const usage = payload.usage as Record<string, unknown> | undefined;
  return Math.max(0, Number(usage?.input_tokens || 0) + Number(usage?.output_tokens || 0));
}

export async function finishAiUsage(
  admin: SupabaseClient,
  reservation: AiReservation | null,
  outcome: boolean | "consumed" | "failed" | "unknown",
  providerRequestId = "",
  actualUnits = 0,
) {
  if (!reservation) return;
  const normalized = typeof outcome === "boolean" ? (outcome ? "consumed" : "failed") : outcome;
  const { error } = await admin.rpc("finish_ai_operation", {
    reservation: reservation.id,
    outcome: normalized,
    provider_request_id: providerRequestId || null,
    actual_cost_units: Math.max(0, Math.trunc(actualUnits)),
  });
  if (error) console.error(JSON.stringify({ event: "ai_usage_finalize_failed", code: error.code || "database_error" }));
}

export function usagePayload(reservation: AiReservation) {
  return { premium: reservation.premium, remaining: reservation.remaining };
}
