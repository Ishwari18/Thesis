import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createPacificaClient, type PacificaClient } from "./client";
import { readPacificaConfig, requireExecutionConfig } from "./config";
import { PacificaError } from "./errors";
import { loadPacificaSigningIdentity, signPacificaAction, type SigningIdentity } from "./signing";
import type { SignedPacificaAction } from "./signing";
import type { OrderRequest } from "../execution/types";

const orderSchema=z.object({success:z.boolean(),data:z.object({order_id:z.union([z.string(),z.number()]).optional()}).passthrough().optional(),error:z.unknown().optional()}).passthrough();
const batchSchema=z.object({success:z.boolean(),data:z.object({results:z.array(z.object({success:z.boolean(),order_id:z.union([z.string(),z.number()]).nullable().optional(),error:z.unknown().nullable().optional()}).passthrough())}).optional()}).passthrough();
const leverageSchema=z.object({success:z.boolean()}).passthrough();
export type BatchOrderResult={status:"accepted"|"rejected";externalId?:string;error?:string};
function executionIdentity(){const config=requireExecutionConfig(readPacificaConfig());return loadPacificaSigningIdentity(config.privateKey,config.accountAddress);}
export function normalizeBatchResults(raw:unknown,expected:number):BatchOrderResult[]{const response=batchSchema.safeParse(raw);if(!response.success||!response.data.success||!response.data.data)throw new PacificaError("http","Pacifica rejected the batch request or returned an invalid response.");if(response.data.data.results.length!==expected)throw new PacificaError("response","Pacifica returned an incomplete batch result; reconcile before retrying.");return response.data.data.results.map(item=>item.success?{status:"accepted",...(item.order_id==null?{}:{externalId:String(item.order_id)})}:{status:"rejected",error:"Pacifica rejected this action."});}
export async function submitPacificaMarketOrder(order:OrderRequest,client:PacificaClient=createPacificaClient()){const identity=executionIdentity();const data={symbol:order.symbol,amount:order.quantity,side:order.side,slippage_percent:order.slippagePercent??"1",reduce_only:order.reduceOnly??false,client_order_id:order.clientOrderId??randomUUID()};const raw=await client.post<unknown>("/api/v1/orders/create_market",signPacificaAction("create_market_order",data,identity));const result=orderSchema.safeParse(raw);if(!result.success||!result.data.success)throw new PacificaError("http","Pacifica rejected the market order.");return {status:"accepted" as const,externalId:result.data.data?.order_id===undefined?undefined:String(result.data.data.order_id),clientOrderId:data.client_order_id};}
export async function submitPacificaMarketBatch(orders:OrderRequest[],client:PacificaClient=createPacificaClient()):Promise<BatchOrderResult[]>{if(orders.length<1||orders.length>10)throw new PacificaError("response","Pacifica batch requests require 1 to 10 actions.");const identity=executionIdentity();const actions=orders.map(order=>({type:"CreateMarket",data:signPacificaAction("create_market_order",{symbol:order.symbol,amount:order.quantity,side:order.side,slippage_percent:order.slippagePercent??"1",reduce_only:order.reduceOnly??false,client_order_id:order.clientOrderId??randomUUID()},identity)}));const raw=await client.post<unknown>("/api/v1/orders/batch",{actions});return normalizeBatchResults(raw,orders.length);}
export async function submitSignedPacificaMarketBatch(signedOrders:SignedPacificaAction[],client:PacificaClient=createPacificaClient()):Promise<BatchOrderResult[]>{if(signedOrders.length<1||signedOrders.length>10)throw new PacificaError("response","Pacifica batch requests require 1 to 10 actions.");const actions=signedOrders.map(data=>({type:"CreateMarket",data}));const raw=await client.post<unknown>("/api/v1/orders/batch",{actions});return normalizeBatchResults(raw,signedOrders.length);}
export async function submitSignedPacificaLeverage(action:SignedPacificaAction,client:PacificaClient=createPacificaClient()){const raw=await client.post<unknown>("/api/v1/account/leverage",action);const result=leverageSchema.safeParse(raw);if(!result.success||!result.data.success)throw new PacificaError("http","Pacifica rejected the leverage update.");}

export async function submitPacificaAgentMarketBatch(orders:OrderRequest[],accountAddress:string,agentAddress:string,identity:SigningIdentity,client:PacificaClient=createPacificaClient()):Promise<BatchOrderResult[]>{
  if(orders.length<1||orders.length>10)throw new PacificaError("response","Pacifica batch requests require 1 to 10 actions.");
  const actions=orders.map(order=>({type:"CreateMarket",data:signPacificaAction("create_market_order",{symbol:order.symbol,amount:order.quantity,side:order.side,slippage_percent:order.slippagePercent??"1",reduce_only:order.reduceOnly??false,client_order_id:order.clientOrderId??randomUUID()},identity,Date.now(),30_000,{account:accountAddress,agentWallet:agentAddress})}));
  const raw=await client.post<unknown>("/api/v1/orders/batch",{actions});
  return normalizeBatchResults(raw,orders.length);
}

export async function submitPacificaAgentLeverage(symbol:string,leverage:number,accountAddress:string,agentAddress:string,identity:SigningIdentity,client:PacificaClient=createPacificaClient()){
  const action=signPacificaAction("update_leverage",{symbol,leverage},identity,Date.now(),30_000,{account:accountAddress,agentWallet:agentAddress});
  await submitSignedPacificaLeverage(action,client);
}
