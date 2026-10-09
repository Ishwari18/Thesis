import "server-only";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { PacificaError } from "./errors";

export type SigningIdentity={account:string;secretKey:Uint8Array};
export function createSigningIdentity(encodedPrivateKey:string,expectedAccount?:string):SigningIdentity{
  let decoded:Uint8Array;try{decoded=bs58.decode(encodedPrivateKey);}catch{throw new PacificaError("configuration","PACIFICA_PRIVATE_KEY must be a base58-encoded Pacifica/Solana Ed25519 keypair.");}
  if(decoded.length!==64)throw new PacificaError("configuration","PACIFICA_PRIVATE_KEY must decode to a 64-byte Ed25519 keypair.");
  const keypair=nacl.sign.keyPair.fromSecretKey(decoded),account=bs58.encode(keypair.publicKey);
  if(expectedAccount&&account!==expectedAccount)throw new PacificaError("configuration","PACIFICA_ACCOUNT_ADDRESS does not match the configured signing key.");
  return {account,secretKey:keypair.secretKey};
}
function recursivelySort(value:unknown):unknown{if(Array.isArray(value))return value.map(recursivelySort);if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,recursivelySort(v)]));return value;}
export function canonicalSigningMessage(type:string,data:Record<string,unknown>,timestamp:number,expiryWindow=5_000){return JSON.stringify(recursivelySort({timestamp,expiry_window:expiryWindow,type,data}));}
export function signPacificaAction(type:string,data:Record<string,unknown>,identity:SigningIdentity,timestamp=Date.now(),expiryWindow=5_000){const message=canonicalSigningMessage(type,data,timestamp,expiryWindow);const signature=bs58.encode(nacl.sign.detached(new TextEncoder().encode(message),identity.secretKey));return {account:identity.account,agent_wallet:null,signature,timestamp,expiry_window:expiryWindow,...data};}
export function loadPacificaSigningIdentity(privateKey:string|undefined,account:string|undefined){if(!privateKey||!account)throw new PacificaError("configuration","Configure the Pacifica testnet account address and private key on the server.");return createSigningIdentity(privateKey,account);}
