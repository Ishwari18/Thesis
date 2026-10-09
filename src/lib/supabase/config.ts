export type SupabasePublicConfig = { url: string; publishableKey: string };
export type SupabaseConfigResult = { ok: true; config: SupabasePublicConfig } | { ok: false; message: string };

function isServiceRoleOrSecretKey(key: string): boolean {
  if (/^sb_secret_/i.test(key)) return true;
  const jwtPayload = key.split(".")[1];
  if (!jwtPayload) return false;
  try {
    const normalized = jwtPayload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(jwtPayload.length / 4) * 4, "=");
    const payload = JSON.parse(atob(normalized)) as { role?: unknown };
    return payload.role === "service_role";
  } catch { return false; }
}

export function validateSupabasePublicConfig(urlValue: string | undefined, keyValue: string | undefined): SupabaseConfigResult {
  const url = urlValue?.trim();
  const publishableKey = keyValue?.trim();
  if (!url) return { ok: false, message: "Supabase is not configured: the project URL is missing." };
  if (!publishableKey) return { ok: false, message: "Supabase is not configured: the publishable key is missing." };
  if (isServiceRoleOrSecretKey(publishableKey)) return { ok: false, message: "Use a Supabase publishable or anon key here. Secret and service-role keys are not safe for browser use." };
  try {
    const parsed = new URL(url);
    const isLocal = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
    if ((parsed.protocol !== "https:" && !(isLocal && parsed.protocol === "http:")) || parsed.pathname !== "/" || parsed.username || parsed.password || parsed.search || parsed.hash) return { ok: false, message: "Supabase project URL must be a valid HTTPS project URL." };
  } catch { return { ok: false, message: "Supabase project URL is not a valid URL." }; }
  return { ok: true, config: { url: url.replace(/\/$/, ""), publishableKey } };
}

export function getSupabasePublicConfig(): SupabaseConfigResult {
  return validateSupabasePublicConfig(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
}
