import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client — the same project the website uses.
 * Server-side only: this key bypasses row-level security.
 */
const URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
// SUPABASE_SECRET_KEY is the name the Vercel ↔ Supabase integration uses.
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "";

export const BUCKET = process.env.SUPABASE_DOCUMENTS_BUCKET || "client-documents";

/** True when the admin is wired to the live website database. */
export const supabaseEnabled = () => Boolean(URL && KEY);

let client: SupabaseClient | null = null;

export function sb(): SupabaseClient {
  if (!supabaseEnabled()) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set");
  client ??= createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}
