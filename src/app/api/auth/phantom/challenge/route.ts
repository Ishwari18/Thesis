import { NextResponse } from "next/server";
import bs58 from "bs58";
import { z } from "zod";
import { getAppUser } from "@/lib/auth/server";
import { createPhantomChallenge } from "@/lib/auth/phantom-challenge";

export const dynamic = "force-dynamic";
const requestSchema = z.object({ address: z.string().min(32).max(44) });

export async function POST(request: Request) {
  const appUser = await getAppUser();
  if (!appUser) return NextResponse.json({ error: "Sign in to link a Phantom wallet." }, { status: 401 });
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Provide a valid Solana wallet address." }, { status: 400 });
  try {
    if (bs58.decode(parsed.data.address).length !== 32) throw new Error("Invalid Solana address");
  } catch {
    return NextResponse.json({ error: "Provide a valid Solana wallet address." }, { status: 400 });
  }

  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) return NextResponse.json({ error: "Wallet linking must be started from this THESIS page." }, { status: 403 });
  try {
    return NextResponse.json(createPhantomChallenge(appUser.userId, parsed.data.address, origin));
  } catch {
    return NextResponse.json({ error: "Secure wallet linking is not configured on this server." }, { status: 503 });
  }
}
