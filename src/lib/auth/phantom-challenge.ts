import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

type PhantomChallenge = { userId: string; address: string; origin: string; nonce: string; issuedAt: string; expiresAt: string };

function signingSecret() {
  const secret = process.env.PRIVY_APP_SECRET;
  if (!secret) throw new Error("Privy server configuration is missing.");
  return secret;
}

function formatMessage(challenge: PhantomChallenge) {
  const host = new URL(challenge.origin).host;
  return `${host} wants you to sign in with your Solana account:\n${challenge.address}\n\nLink this wallet to your THESIS account.\n\nURI: ${challenge.origin}\nVersion: 1\nChain ID: devnet\nNonce: ${challenge.nonce}\nIssued At: ${challenge.issuedAt}\nExpiration Time: ${challenge.expiresAt}`;
}

export function createPhantomChallenge(userId: string, address: string, origin: string) {
  const now = Date.now();
  const payload: PhantomChallenge = {
    userId,
    address,
    origin,
    nonce: randomBytes(16).toString("hex"),
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 5 * 60_000).toISOString(),
  };
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", signingSecret()).update(data).digest("base64url");
  return { challenge: `${data}.${signature}`, message: formatMessage(payload) };
}

export function verifyPhantomChallenge(token: string) {
  const [data, providedSignature, ...extra] = token.split(".");
  if (!data || !providedSignature || extra.length) return null;
  const expectedSignature = createHmac("sha256", signingSecret()).update(data).digest();
  let signature: Buffer;
  try { signature = Buffer.from(providedSignature, "base64url"); } catch { return null; }
  if (signature.length !== expectedSignature.length || !timingSafeEqual(signature, expectedSignature)) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, "base64url").toString("utf8")) as PhantomChallenge;
    if (!payload.userId || !payload.address || !payload.origin || !payload.nonce || Date.parse(payload.expiresAt) <= Date.now()) return null;
    return { ...payload, message: formatMessage(payload) };
  } catch {
    return null;
  }
}
