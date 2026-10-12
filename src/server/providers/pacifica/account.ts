import "server-only";
import { z } from "zod";
import { createPacificaClient, type PacificaClient } from "./client";
import { readPacificaConfig } from "./config";
import { PacificaError } from "./errors";
import type { PacificaAccount } from "./types";
const envelope=z.object({success:z.boolean(),data:z.unknown()});
const schema=z.object({account_equity:z.string().optional(),available_to_spend:z.string().optional(),total_margin_used:z.string().optional(),balance:z.string().optional(),updated_at:z.number().optional()}).passthrough();
export async function getPacificaAccount(client:PacificaClient=createPacificaClient(), requestedAddress?:string):Promise<PacificaAccount>{const {accountAddress}=readPacificaConfig();const address=requestedAddress??accountAddress;if(!address)throw new PacificaError("configuration","A linked Solana wallet is required to read a Pacifica testnet account.");const raw=await client.get<unknown>("/api/v1/account",{account:address});const response=envelope.safeParse(raw);const data=response.success&&response.data.success?schema.safeParse(response.data.data):undefined;if(!data?.success)throw new PacificaError("response","Pacifica account response was invalid.");return {address,...(data.data.account_equity?{equity:data.data.account_equity}:{}),...(data.data.available_to_spend?{availableBalance:data.data.available_to_spend}:{}),...(data.data.total_margin_used?{marginUsed:data.data.total_margin_used}:{}),...(data.data.balance?{balance:data.data.balance}:{}),...(data.data.updated_at?{updatedAt:new Date(data.data.updated_at).toISOString()}:{}),source:"pacifica-testnet"};}
