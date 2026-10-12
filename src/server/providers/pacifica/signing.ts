import "server-only";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { PacificaError } from "./errors";
import { pacificaSigningMessage } from "@/lib/pacifica-signing";

export type SigningIdentity={account:string;secretKey:Uint8Array};
export function createSigningIdentity(encodedPrivateKey:string,expectedAccount?:string):SigningIdentity{
  let decoded:Uint8Array;try{decoded=bs58.decode(encodedPrivateKey);}catch{throw new PacificaError("configuration","PACIFICA_PRIVATE_KEY must be a base58-encoded Pacifica/Solana Ed25519 keypair.");}
  if(decoded.length!==64)throw new PacificaError("configuration","PACIFICA_PRIVATE_KEY must decode to a 64-byte Ed25519 keypair.");
  const keypair=nacl.sign.keyPair.fromSecretKey(decoded),account=bs58.encode(keypair.publicKey);
  if(expectedAccount&&account!==expectedAccount)throw new PacificaError("configuration","PACIFICA_ACCOUNT_ADDRESS does not match the configured signing key.");
  return {account,secretKey:keypair.secretKey};
}
export const canonicalSigningMessage = pacificaSigningMessage;
export function signPacificaAction(type:string,data:Record<string,unknown>,identity:SigningIdentity,timestamp=Date.now(),expiryWindow=30_000,delegation?:{account:string;agentWallet:string}){const message=canonicalSigningMessage(type,data,timestamp,expiryWindow);const signature=bs58.encode(nacl.sign.detached(new TextEncoder().encode(message),identity.secretKey));return {account:delegation?.account??identity.account,agent_wallet:delegation?.agentWallet??null,signature,timestamp,expiry_window:expiryWindow,...data};}
export type SignedPacificaAction={account:string;agent_wallet:string|null;signature:string;timestamp:number;expiry_window:number;[key:string]:unknown};
export function verifyPacificaAction(action:unknown,type:string,expectedAccount:string):SignedPacificaAction|null{
  if(!action||typeof action!=="object"||Array.isArray(action))return null;
  const value=action as Record<string,unknown>;
  if(value.account!==expectedAccount||value.agent_wallet!==null||typeof value.signature!=="string"||!Number.isSafeInteger(value.timestamp)||!Number.isSafeInteger(value.expiry_window))return null;
  const timestamp=value.timestamp as number,expiry=value.expiry_window as number,age=Date.now()-timestamp;
  if(expiry<1_000||expiry>60_000||age < -5_000||age>expiry)return null;
  let publicKey:Uint8Array,signature:Uint8Array;
  try{publicKey=bs58.decode(expectedAccount);signature=bs58.decode(value.signature);}catch{return null;}
  if(publicKey.length!==32||signature.length!==64)return null;
  const data=Object.fromEntries(Object.entries(value).filter(([key])=>!new Set(["account","agent_wallet","signature","timestamp","expiry_window"]).has(key)));
  const message=canonicalSigningMessage(type,data,timestamp,expiry);
  if(!nacl.sign.detached.verify(new TextEncoder().encode(message),signature,publicKey))return null;
  return value as SignedPacificaAction;
}
export function loadPacificaSigningIdentity(privateKey:string|undefined,account:string|undefined){if(!privateKey||!account)throw new PacificaError("configuration","Configure the Pacifica testnet account address and private key on the server.");return createSigningIdentity(privateKey,account);}
