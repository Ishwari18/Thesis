import { NextResponse } from "next/server";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { z } from "zod";
import { getAppUser, adminClient } from "@/lib/auth/server";
import { verifyPhantomChallenge } from "@/lib/auth/phantom-challenge";

export const dynamic = "force-dynamic";
const requestSchema = z.object({ challenge: z.string().min(1), signature: z.string().min(1) });

export async function GET() {
  const appUser = await getAppUser();
  if (!appUser) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  const { data, error } = await adminClient().from("phantom_wallet_links").select("address").eq("user_id", appUser.userId).maybeSingle();
  if (error) return NextResponse.json({ error: "Could not load the linked Phantom wallet." }, { status: 503 });
  return NextResponse.json({ address: data?.address ?? null });
}

export async function POST(request: Request) {
  const appUser = await getAppUser();
  if (!appUser) return NextResponse.json({ error: "Sign in to link a Phantom wallet." }, { status: 401 });
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Provide the signed Phantom wallet challenge." }, { status: 400 });
  let challenge;
  try { challenge = verifyPhantomChallenge(parsed.data.challenge); } catch { challenge = null; }
  const origin = request.headers.get("origin");
  if (!challenge || challenge.userId !== appUser.userId || challenge.origin !== origin || challenge.origin !== new URL(request.url).origin) {
    return NextResponse.json({ error: "The wallet challenge is invalid or expired. Try connecting again." }, { status: 400 });
  }

  try {
    const signature = bs58.decode(parsed.data.signature);
    const publicKey = bs58.decode(challenge.address);
    const valid = nacl.sign.detached.verify(new TextEncoder().encode(challenge.message), signature, publicKey);
    if (!valid) return NextResponse.json({ error: "Phantom did not verify ownership of this address." }, { status: 403 });
  } catch {
    return NextResponse.json({ error: "Phantom returned an invalid signature." }, { status: 400 });
  }

  const { error } = await adminClient().from("phantom_wallet_links").upsert({
    user_id: appUser.userId,
    address: challenge.address,
    verified_at: new Date().toISOString(),
  }, { onConflict: "user_id" });
  if (error) return NextResponse.json({ error: "This Phantom address is already linked to another THESIS account, or the wallet link could not be saved." }, { status: 409 });
  return NextResponse.json({ address: challenge.address });
}

export async function DELETE() {
  const appUser = await getAppUser();
  if (!appUser) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  const { error } = await adminClient().from("phantom_wallet_links").delete().eq("user_id", appUser.userId);
  if (error) return NextResponse.json({ error: "Could not unlink the Phantom wallet." }, { status: 503 });
  return NextResponse.json({ address: null });
}
