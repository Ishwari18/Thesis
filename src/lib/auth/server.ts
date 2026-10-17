import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { createHash } from "node:crypto";
import { PrivyClient } from "@privy-io/server-auth";
import { createClient } from "@supabase/supabase-js";

const privy = new PrivyClient(process.env.PRIVY_APP_ID!, process.env.PRIVY_APP_SECRET!);

// Server only. Bypasses RLS, so every query must filter by the verified user id.
export const adminClient = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

/** Confirm that this authenticated THESIS user has proven ownership of the address. */
export async function hasLinkedSolanaWallet(userId: string, address: string): Promise<boolean> {
  const { data, error } = await adminClient().from("phantom_wallet_links")
    .select("address").eq("user_id", userId).eq("address", address).maybeSingle();
  return !error && Boolean(data);
}

export async function getLinkedSolanaWallet(userId: string): Promise<string | null> {
  const { data, error } = await adminClient().from("phantom_wallet_links")
    .select("address").eq("user_id", userId).maybeSingle();
  if (error) {
    console.error("[auth] Linked Phantom wallet lookup failed:", error.message);
    return null;
  }
  return typeof data?.address === "string" ? data.address : null;
}

export const getAppUser = cache(async (): Promise<{ privyId: string; userId: string } | null> => {
  const token = (await cookies()).get("privy-token")?.value;
  if (!token) {
    console.warn("[auth] THESIS session cookie is missing.");
    return null;
  }

  let privyId: string;
  try {
    privyId = (await privy.verifyAuthToken(token)).userId; // checks signature + expiry
  } catch (error) {
    console.error("[auth] THESIS session token verification failed:", error);
    return null;
  }

  const db = adminClient();
  const lookup = async () => {
    const { data, error } = await db.from("privy_links").select("user_id").eq("privy_id", privyId).maybeSingle();
    if (error) console.error("[auth] Privy account-link lookup failed:", error.message);
    return data?.user_id as string | undefined;
  };

  const existing = await lookup();
  if (existing) return { privyId, userId: existing };

  // First sign-in: create the backing Supabase user once, then link it.
  const email = `${createHash("sha256").update(privyId).digest("hex").slice(0, 32)}@users.thesis.invalid`;
  const { data, error } = await db.auth.admin.createUser({
    email, email_confirm: true, user_metadata: { privy_id: privyId },
  });
  if (error || !data.user) {
    console.error("[auth] Could not create the THESIS account for this Privy user:", error?.message ?? "Supabase returned no user.");
    const raced = await lookup(); // another request may have just created it
    return raced ? { privyId, userId: raced } : null;
  }
  const { error: linkError } = await db.from("privy_links").insert({ privy_id: privyId, user_id: data.user.id });
  if (linkError) {
    console.error("[auth] Could not save the Privy account link:", linkError.message);
    const raced = await lookup();
    return raced ? { privyId, userId: raced } : null;
  }
  return { privyId, userId: data.user.id };
});
