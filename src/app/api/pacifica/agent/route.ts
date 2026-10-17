import bs58 from "bs58";
import nacl from "tweetnacl";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getAppUser, getLinkedSolanaWallet, adminClient } from "@/lib/auth/server";
import { pacificaSigningMessage } from "@/lib/pacifica-signing";
import { derivePacificaTradeAgent, getBoundPacificaTradeAgent } from "@/server/providers/pacifica/agent-wallet";
import { createPacificaClient } from "@/server/providers/pacifica/client";
import { safePacificaMessage } from "@/server/providers/pacifica/errors";

export const dynamic = "force-dynamic";

const bindSchema = z.object({
  account: z.string().min(32).max(64),
  agent_wallet: z.string().min(32).max(64),
  signature: z.string().min(80).max(100),
  timestamp: z.number().int().safe(),
  expiry_window: z.number().int().min(1_000).max(60_000),
});

export async function GET() {
  const appUser = await getAppUser();

  if (!appUser) {
    return NextResponse.json(
      { error: "Sign in to configure one-confirmation trading." },
      { status: 401 },
    );
  }

  const accountAddress = await getLinkedSolanaWallet(appUser.userId);

  if (!accountAddress) {
    return NextResponse.json(
      { error: "Connect and link Phantom first." },
      { status: 403 },
    );
  }

  try {
    const db = adminClient() as unknown as Parameters<
      typeof getBoundPacificaTradeAgent
    >[0];

    const agent = derivePacificaTradeAgent(
      appUser.userId,
      accountAddress,
    );

    const bound = await getBoundPacificaTradeAgent(
      db,
      appUser.userId,
      accountAddress,
    );

    return NextResponse.json({
      accountAddress,
      agentAddress: agent.agentAddress,
      bound: Boolean(bound),
    });
  } catch (error) {
    return NextResponse.json(
      { error: safePacificaMessage(error) },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  const appUser = await getAppUser();
  if (!appUser) return NextResponse.json({ error: "Sign in to configure one-confirmation trading." }, { status: 401 });
  const accountAddress = await getLinkedSolanaWallet(appUser.userId);
  if (!accountAddress) return NextResponse.json({ error: "Connect and link Phantom first." }, { status: 403 });
  const parsed = bindSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || parsed.data.account !== accountAddress) return NextResponse.json({ error: "The Phantom approval did not match your linked wallet." }, { status: 422 });

  try {
    const agent = derivePacificaTradeAgent(appUser.userId, accountAddress);
    const { agent_wallet: target, signature: encodedSignature, timestamp, expiry_window } = parsed.data;
    if (target !== agent.agentAddress) return NextResponse.json({ error: "The approval is for a different THESIS trade agent." }, { status: 422 });
    const age = Date.now() - timestamp;
    if (age < -5_000 || age > expiry_window) return NextResponse.json({ error: "The Phantom approval expired. Please approve the trade agent again." }, { status: 422 });
    let publicKey: Uint8Array, signature: Uint8Array;
    try { publicKey = bs58.decode(accountAddress); signature = bs58.decode(encodedSignature); }
    catch { return NextResponse.json({ error: "The Phantom signature is invalid." }, { status: 422 }); }
    const message = pacificaSigningMessage("bind_agent_wallet", { agent_wallet: target }, timestamp, expiry_window);
    if (publicKey.length !== 32 || signature.length !== 64 || !nacl.sign.detached.verify(new TextEncoder().encode(message), signature, publicKey)) {
      return NextResponse.json({ error: "Phantom could not verify the trade-agent approval." }, { status: 422 });
    }

    const client = createPacificaClient();
    const response = await client.post<unknown>("/api/v1/agent/bind", parsed.data);
    const accepted = z.object({ success: z.literal(true) }).passthrough().safeParse(response);
    if (!accepted.success) return NextResponse.json({ error: "Pacifica did not confirm the trade-agent binding." }, { status: 502 });

    const { error } = await adminClient().from("pacifica_agent_wallet_links").upsert({
      user_id: appUser.userId,
      account_address: accountAddress,
      agent_address: agent.agentAddress,
    }, { onConflict: "user_id" });
    if (error) {
      console.error("[pacifica] Agent was bound but THESIS could not save the link:", error.message);
      return NextResponse.json({ error: "Pacifica bound the trade agent, but THESIS could not save its setup. Refresh and retry the setup." }, { status: 503 });
    }
    return NextResponse.json({ bound: true, agentAddress: agent.agentAddress });
  } catch (error) {
    return NextResponse.json({ error: safePacificaMessage(error) }, { status: 503 });
  }
}
