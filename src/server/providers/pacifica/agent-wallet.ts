import "server-only";
import { createHmac } from "node:crypto";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { PacificaError } from "./errors";
import type { SigningIdentity } from "./signing";

export type PacificaTradeAgent = { accountAddress: string; agentAddress: string; identity: SigningIdentity };
type AgentDb = {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        maybeSingle(): Promise<{ data: unknown; error: { message?: string } | null }>;
      };
    };
  };
};

/** A deterministic, per-user trade-only key; PACIFICA_AGENT_KEY_SECRET must be a Vercel server secret. */
export function derivePacificaTradeAgent(userId: string, accountAddress: string): PacificaTradeAgent {
  const secret = process.env.PACIFICA_AGENT_KEY_SECRET;
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new PacificaError("configuration", "Set PACIFICA_AGENT_KEY_SECRET to a random server secret of at least 32 characters to enable one-confirmation trading.");
  }
  const seed = createHmac("sha256", secret).update(`thesis-pacifica-agent-v1:${userId}:${accountAddress}`).digest();
  const keypair = nacl.sign.keyPair.fromSeed(seed);
  const agentAddress = bs58.encode(keypair.publicKey);
  return { accountAddress, agentAddress, identity: { account: agentAddress, secretKey: keypair.secretKey } };
}

export async function getBoundPacificaTradeAgent(db: AgentDb, userId: string, accountAddress: string): Promise<PacificaTradeAgent | null> {
  const agent = derivePacificaTradeAgent(userId, accountAddress);
  const { data, error } = await db.from("pacifica_agent_wallet_links")
    .select("account_address,agent_address").eq("user_id", userId).maybeSingle();
  if (error) throw new PacificaError("configuration", "Could not verify this wallet's Pacifica trade-agent setup.");
  const row = data && typeof data === "object" ? data as Record<string, unknown> : null;
  if (row?.account_address !== accountAddress || row?.agent_address !== agent.agentAddress) return null;
  return agent;
}
