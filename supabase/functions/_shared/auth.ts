import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { HttpError } from "./http.ts";

export type AuthContext = { user: User; client: SupabaseClient };

export async function requireUser(request: Request): Promise<AuthContext> {
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.toLowerCase().startsWith("bearer ")) {
    throw new HttpError(401, "Authentication required", "not_authenticated");
  }

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  if (!url || !key) throw new Error("Supabase function environment is incomplete");

  const client = createClient(url, key, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const token = authorization.slice(7).trim();
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Session is invalid or expired", "invalid_session");
  return { user: data.user, client };
}
