export type AuthMode = "sign-in" | "sign-up" | "password-reset";
type ErrorFields = { message?: unknown; code?: unknown; status?: unknown; statusCode?: unknown; name?: unknown };
function getFields(error: unknown): ErrorFields { return error && typeof error === "object" ? error as ErrorFields : {}; }
function safeField(value: unknown): string | undefined { return typeof value === "string" && /^[a-z0-9_.-]{1,80}$/i.test(value) ? value : undefined; }
function safeMessage(value: unknown, sensitiveValues: string[]): string | undefined {
  if (typeof value !== "string") return undefined;
  let message = value.replace(/[\r\n\t]+/g, " ").slice(0, 240);
  for (const secret of sensitiveValues) if (secret) message = message.split(secret).join("[redacted]");
  return message.replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [redacted]").replace(/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "[redacted token]");
}
export function describeAuthError(error: unknown, mode: AuthMode, sensitiveValues: string[] = []): { message: string; diagnostic: string } {
  const fields = getFields(error);
  const code = safeField(fields.code)?.toLowerCase();
  const status = typeof fields.status === "number" ? fields.status : typeof fields.statusCode === "number" ? fields.statusCode : undefined;
  const raw = typeof fields.message === "string" ? fields.message : error instanceof Error ? error.message : "";
  const normalized = raw.toLowerCase();
  const name = safeField(fields.name);
  const networkFailure = error instanceof TypeError || normalized.includes("failed to fetch") || normalized.includes("networkerror") || normalized.includes("fetch failed");
  let message: string;
  if (networkFailure) message = "Could not reach Supabase. Check your connection and project URL, then try again.";
  else if (code === "invalid_credentials" || normalized.includes("invalid login credentials")) message = "Email or password is incorrect. If you just created this account, confirm your email first.";
  else if (code === "email_not_confirmed") message = "Confirm your email before signing in. Check your inbox and spam folder for the confirmation link.";
  else if (code === "email_exists" || code === "user_already_exists" || normalized.includes("already registered")) message = mode === "sign-up" ? "An account may already exist for this email. Try signing in instead." : "This account already exists. Try signing in.";
  else if (code === "weak_password" || code === "password_too_short" || normalized.includes("password should")) message = "That password does not meet this project’s password policy. Choose a longer password and try again.";
  else if (code === "signup_disabled" || code === "email_provider_disabled") message = "Email sign-up is disabled for this Supabase project. Ask the project administrator to enable it.";
  else if (code === "over_email_send_rate_limit" || code === "over_request_rate_limit" || status === 429) message = "Too many authentication requests. Wait a few minutes before trying again.";
  else if (code === "email_address_invalid" || code === "validation_failed") message = "Check the email address and password, then try again.";
  else if (code === "invalid_api_key" || code === "bad_jwt" || code === "no_authorization") message = "Supabase rejected the public project configuration. Check the project URL and publishable key.";
  else if (status && status >= 500) message = "Supabase is temporarily unavailable. Try again shortly.";
  else if (status === 400) message = "Supabase rejected this request. See the development diagnostic below for its safe error code.";
  else message = "Authentication could not be completed. Please try again.";
  const diagnosticParts = ["Supabase Auth"];
  if (status !== undefined) diagnosticParts.push(`HTTP ${status}`);
  if (code) diagnosticParts.push(`code=${code}`);
  if (name) diagnosticParts.push(`name=${name}`);
  const diagnosticMessage = safeMessage(raw, sensitiveValues);
  if (diagnosticMessage) diagnosticParts.push(`message=${diagnosticMessage}`);
  return { message, diagnostic: diagnosticParts.join("; ") };
}
