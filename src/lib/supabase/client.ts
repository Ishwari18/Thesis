import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./database.types";
import { getSupabasePublicConfig } from "./config";
export function createClient() {
  const result = getSupabasePublicConfig();
  if (!result.ok) throw new Error(result.message);
  return createBrowserClient<Database>(result.config.url, result.config.publishableKey);
}
