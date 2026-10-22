import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { HttpError } from "./http.ts";

type LimitResult = { allowed: boolean; remaining: number; reset_at: string };

export async function enforceRateLimit(
  client: SupabaseClient,
  bucket: string,
  maxRequests: number,
  windowSeconds: number,
) {
  const { data, error } = await client.rpc("consume_rate_limit", {
    bucket_name: bucket,
    max_requests: maxRequests,
    window_seconds: windowSeconds,
  });
  if (error) throw new Error(`Rate limit check failed: ${error.message}`);
  const result = (data?.[0] || null) as LimitResult | null;
  if (!result?.allowed) {
    throw new HttpError(429, "Too many requests. Please try again later.", "rate_limited");
  }
  return result;
}
