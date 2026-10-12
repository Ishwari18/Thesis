import "server-only";
import bs58 from "bs58";
import nacl from "tweetnacl";
import type { ThesisTradeApproval } from "@/lib/trading/trade-approval";
import { thesisTradeApprovalMessage } from "@/lib/trading/trade-approval";

export function verifyThesisTradeApproval(approval: ThesisTradeApproval, encodedSignature: string, expected: ThesisTradeApproval) {
  if (approval.account !== expected.account || approval.thesisSlug !== expected.thesisSlug || approval.collateral !== expected.collateral || approval.leverage !== expected.leverage || approval.side !== expected.side || approval.idempotencyKey !== expected.idempotencyKey) return false;
  if (JSON.stringify(approval.legs) !== JSON.stringify(expected.legs)) return false;
  const age = Date.now() - approval.timestamp;
  if (!Number.isSafeInteger(approval.timestamp) || age < -5_000 || age > 120_000) return false;
  try {
    const publicKey = bs58.decode(expected.account);
    const signature = bs58.decode(encodedSignature);
    return publicKey.length === 32 && signature.length === 64 && nacl.sign.detached.verify(new TextEncoder().encode(thesisTradeApprovalMessage(approval)), signature, publicKey);
  } catch {
    return false;
  }
}
