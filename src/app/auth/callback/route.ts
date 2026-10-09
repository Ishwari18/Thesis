import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeAuthRedirectPath } from "@/lib/supabase/redirect";
function authErrorRedirect(origin: string) {
  const target = new URL("/auth", origin);
  target.searchParams.set("auth_error", "confirmation");
  return NextResponse.redirect(target);
}
export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const code = request.nextUrl.searchParams.get("code");
  const nextPath = safeAuthRedirectPath(request.nextUrl.searchParams.get("next"));
  if (!code) return authErrorRedirect(origin);
  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return authErrorRedirect(origin);
    return NextResponse.redirect(new URL(nextPath, origin));
  } catch { return authErrorRedirect(origin); }
}
