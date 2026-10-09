import "server-only";
import { z } from "zod";
import { createPacificaClient, type PacificaClient } from "./client";
import { readPacificaConfig, requireExecutionConfig } from "./config";
import { PacificaError } from "./errors";
import { loadPacificaSigningIdentity, signPacificaAction } from "./signing";
import { pacificaMetadataProvider } from "../market-metadata/pacifica";
const responseSchema=z.object({success:z.boolean(),error:z.unknown().optional()}).passthrough();
export async function setPacificaLeverage(symbol:string,leverage:number,client:PacificaClient=createPacificaClient()){const config=requireExecutionConfig(readPacificaConfig()),identity=loadPacificaSigningIdentity(config.privateKey,config.accountAddress);if(!Number.isInteger(leverage)||leverage<1)throw new PacificaError("response","Requested Pacifica leverage is invalid.");const market=await pacificaMetadataProvider.getMarket(symbol);if(!market?.active)throw new PacificaError("response",`Pacifica market ${symbol} is missing or inactive.`);if(leverage>market.maxLeverage)throw new PacificaError("response",`Pacifica market ${symbol} supports at most ${market.maxLeverage}x leverage.`);const body=signPacificaAction("update_leverage",{symbol,leverage},identity);const raw=await client.post<unknown>("/api/v1/account/leverage",body);const result=responseSchema.safeParse(raw);if(!result.success||!result.data.success)throw new PacificaError("http","Pacifica rejected the leverage update.");return {status:"accepted" as const};}
