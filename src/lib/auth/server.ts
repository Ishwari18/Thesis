import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { createHash } from "node:crypto";
import { PrivyClient } from "@privy-io/server-auth";
import { createClient } from "@supabase/supabase-js";

const privy = new PrivyClient(process.env.NEXT_PUBLIC_PRIVY_APP_ID!, process.env.PRIVY_APP_SECRET!);

// Server only. Bypasses RLS, so every query must filter by the verified user id.
export const adminClient = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

export const getAppUser = cache(async (): Promise<{ privyId: string; userId: string } | null> => {
  const token = (await cookies()).get("privy-token")?.value;
  if (!token) return null;

  let privyId: string;
  try {
    privyId = (await privy.verifyAuthToken(token)).userId; // checks signature + expiry
  } catch {
    return null;
  }

  const db = adminClient();
  const lookup = async () =>
    (await db.from("privy_links").select("user_id").eq("privy_id", privyId).maybeSingle()).data?.user_id as string | undefined;

  const existing = await lookup();
  if (existing) return { privyId, userId: existing };

  // First sign-in: create the backing Supabase user once, then link it.
  const email = `${createHash("sha256").update(privyId).digest("hex").slice(0, 32)}@users.thesis.invalid`;
  const { data, error } = await db.auth.admin.createUser({
    email, email_confirm: true, user_metadata: { privy_id: privyId },
  });
  if (error || !data.user) {
    const raced = await lookup(); // another request may have just created it
    return raced ? { privyId, userId: raced } : null;
  }
  await db.from("privy_links").insert({ privy_id: privyId, user_id: data.user.id });
  return { privyId, userId: data.user.id };
});