import bs58 from "bs58";
import { pacificaSigningMessage } from "@/lib/pacifica-signing";
import type { ThesisTradeApproval } from "@/lib/trading/trade-approval";
import { thesisTradeApprovalMessage } from "@/lib/trading/trade-approval";

type PhantomPublicKey = { toString(): string };
export type PhantomSolanaProvider = {
  isPhantom?: boolean;
  isConnected?: boolean;
  publicKey?: PhantomPublicKey | null;
  connect: (options?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey: PhantomPublicKey }>;
  signMessage: (message: Uint8Array, encoding?: "utf8") => Promise<{ signature: Uint8Array }>;
  disconnect?: () => Promise<void>;
};

let connectedPhantomAddress: string | null = null;

async function activePhantomAddress(provider: PhantomSolanaProvider) {
  // Phantom exposes its already-approved key on the provider. Reusing it avoids
  // issuing a fresh connect request before every Pacifica message signature.
  const address = provider.publicKey?.toString();
  if (address) {
    connectedPhantomAddress = address;
    return address;
  }
  if (connectedPhantomAddress && provider.isConnected !== false) return connectedPhantomAddress;
  const connected = await provider.connect();
  connectedPhantomAddress = connected.publicKey.toString();
  return connectedPhantomAddress;
}

export function getInjectedPhantom(): PhantomSolanaProvider | null {
  if (typeof window === "undefined") return null;
  const browserWindow = window as Window & { phantom?: { solana?: PhantomSolanaProvider }; solana?: PhantomSolanaProvider };
  const provider = browserWindow.phantom?.solana;
  if (provider?.isPhantom) return provider;
  return browserWindow.solana?.isPhantom ? browserWindow.solana : null;
}

export async function disconnectInjectedPhantom() {
  await getInjectedPhantom()?.disconnect?.();
  connectedPhantomAddress = null;
}

export async function signPacificaActionWithPhantom(type: string, data: Record<string, unknown>, expectedAddress: string) {
  const provider = getInjectedPhantom();
  if (!provider) throw new Error("Phantom extension isn't available in this browser.");
  const account = await activePhantomAddress(provider);
  if (account !== expectedAddress) throw new Error("The active Phantom account changed. Reconnect the wallet and try again.");
  const timestamp = Date.now();
  const expiry_window = 30_000;
  const message = pacificaSigningMessage(type, data, timestamp, expiry_window);
  const { signature } = await provider.signMessage(new TextEncoder().encode(message), "utf8");
  return { account, agent_wallet: null, signature: bs58.encode(signature), timestamp, expiry_window, ...data };
}

export async function signThesisTradeApprovalWithPhantom(approval: ThesisTradeApproval, expectedAddress: string) {
  const provider = getInjectedPhantom();
  if (!provider) throw new Error("Phantom extension isn't available in this browser.");
  const account = await activePhantomAddress(provider);
  if (account !== expectedAddress || approval.account !== expectedAddress) throw new Error("The active Phantom account changed. Reconnect the wallet and review the trade again.");
  const { signature } = await provider.signMessage(new TextEncoder().encode(thesisTradeApprovalMessage(approval)), "utf8");
  return bs58.encode(signature);
}

export async function connectAndLinkPhantom() {
  const provider = getInjectedPhantom();
  if (!provider) throw new Error("Phantom extension isn't available in this browser. Open THESIS in the browser profile where Phantom is installed.");

  const address = await activePhantomAddress(provider);
  const challengeResponse = await fetch("/api/auth/phantom/challenge", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address }),
  });
  const challenge = await challengeResponse.json() as { message?: string; challenge?: string; error?: string };
  if (!challengeResponse.ok || !challenge.message || !challenge.challenge) throw new Error(challenge.error ?? "Could not start secure Phantom wallet linking.");

  const { signature } = await provider.signMessage(new TextEncoder().encode(challenge.message), "utf8");
  const linkResponse = await fetch("/api/auth/phantom", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ challenge: challenge.challenge, signature: bs58.encode(signature) }),
  });
  const result = await linkResponse.json() as { address?: string; error?: string };
  if (!linkResponse.ok || result.address !== address) throw new Error(result.error ?? "THESIS could not verify and link this Phantom wallet.");
  connectedPhantomAddress = address;
  return address;
}
