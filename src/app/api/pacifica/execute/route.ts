import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { previewAllocation } from "@/server/services/allocation";
import { fetchPacificaSnapshot } from "@/server/providers/pacifica/market-data";
import { requireExecutionConfig, readPacificaConfig } from "@/server/providers/pacifica/config";
import { loadPacificaSigningIdentity } from "@/server/providers/pacifica/signing";
import { setPacificaLeverage } from "@/server/providers/pacifica/leverage";
import { submitPacificaMarketBatch } from "@/server/providers/pacifica/orders";
import { safePacificaMessage } from "@/server/providers/pacifica/errors";
export const dynamic="force-dynamic";
const inputSchema=z.object({allocationId:z.string().uuid(),idempotencyKey:z.string().uuid()});
const intentSchema=z.object({batch_id:z.string().uuid(),existing:z.boolean(),status:z.string()});
const allocationSchema=z.object({id:z.string().uuid(),user_id:z.string().uuid(),thesis_id:z.string().uuid(),collateral:z.string(),leverage:z.number(),status:z.string()});
const legsSchema=z.array(z.object({id:z.string().uuid(),market_id:z.string().uuid(),direction:z.enum(["long","short"]),entry_weight:z.string()}));
const marketsSchema=z.array(z.object({id:z.string().uuid(),symbol:z.string()}));
type DbResult={data:unknown;error:{message?:string}|null};
type DbQuery=PromiseLike<DbResult>&{select:(columns:string)=>DbQuery;eq:(column:string,value:string)=>DbQuery;in:(column:string,values:string[])=>DbQuery;maybeSingle:()=>Promise<DbResult>};
type ExecutionDb={from:(table:string)=>DbQuery;rpc:(name:string,args:Record<string,unknown>)=>Promise<DbResult>};

export async function POST(request:Request){
  const client=await createClient();
  const {data:{user}}=await client.auth.getUser();
  const supabase=client as unknown as ExecutionDb;
  if(!user)return NextResponse.json({error:"Sign in is required."},{status:401});
  let config;
  try{config=requireExecutionConfig(readPacificaConfig());loadPacificaSigningIdentity(config.privateKey,config.accountAddress);}
  catch(error){return NextResponse.json({error:safePacificaMessage(error)},{status:503});}
  if(user.id!==config.allowedUserId)return NextResponse.json({error:"Testnet execution is restricted to the configured single Supabase user."},{status:403});
  const parsed=inputSchema.safeParse(await request.json().catch(()=>null));
  if(!parsed.success)return NextResponse.json({error:"Provide an allocation ID and a UUID idempotency key."},{status:400});
  const {allocationId,idempotencyKey}=parsed.data;
  const {data:allocationRaw,error:allocationError}=await supabase.from("thesis_allocations").select("id,user_id,thesis_id,collateral,leverage,status").eq("id",allocationId).eq("user_id",user.id).maybeSingle();
  const allocation=allocationSchema.safeParse(allocationRaw);
  if(allocationError||!allocation.success)return NextResponse.json({error:"The requested thesis allocation was not found."},{status:404});
  const allocationRow=allocation.data;
  if(!["pending","open"].includes(allocationRow.status))return NextResponse.json({error:"This thesis allocation is not eligible for another execution."},{status:409});
  if(![2,3,5].includes(Number(allocationRow.leverage)))return NextResponse.json({error:"This allocation uses a leverage setting that THESIS does not support."},{status:422});
  const {data:legsRaw,error:legsError}=await supabase.from("allocation_legs").select("id,market_id,direction,entry_weight").eq("allocation_id",allocationId);
  const allocationLegs=legsSchema.safeParse(legsRaw);
  if(legsError||!allocationLegs.success||allocationLegs.data.length<1||allocationLegs.data.length>10)return NextResponse.json({error:"The allocation needs between one and ten saved thesis legs."},{status:422});
  const marketIds=allocationLegs.data.map(l=>l.market_id);
  const {data:marketsRaw,error:marketsError}=await supabase.from("markets").select("id,symbol").in("id",marketIds);
  const dbMarkets=marketsSchema.safeParse(marketsRaw);
  if(marketsError||!dbMarkets.success||dbMarkets.data.length!==allocationLegs.data.length)return NextResponse.json({error:"The saved allocation market catalogue is incomplete."},{status:503});
  let snapshot;
  try{snapshot=await fetchPacificaSnapshot();}catch(error){return NextResponse.json({error:safePacificaMessage(error)},{status:503});}
  const marketsById=new Map(dbMarkets.data.map(m=>[m.id,m.symbol]));
  const assets=allocationLegs.data.map(leg=>({symbol:marketsById.get(leg.market_id)!,weight:leg.entry_weight,direction:leg.direction,active:true,maxLeverage:50,minNotional:"0"}));
  const preview=previewAllocation({assets},allocationRow.collateral,Number(allocationRow.leverage),{markets:snapshot.markets,quotes:snapshot.quotes,source:"pacifica-testnet"});
  if(!preview.valid)return NextResponse.json({error:preview.error??"Allocation is not eligible for testnet execution.",preview},{status:422});
  const orders=allocationLegs.data.map((leg,index)=>{const item=preview.legs[index];return {legId:leg.id,symbol:item.symbol,side:item.direction==="long"?"bid" as const:"ask" as const,quantity:item.quantity,clientOrderId:randomUUID()};});
  if(orders.some(order=>!order.quantity))return NextResponse.json({error:"Pacifica lot-size validation could not calculate every order quantity."},{status:422});
  const intentLegs=orders.map(order=>({allocation_leg_id:order.legId,side:order.side,requested_quantity:order.quantity!,client_order_id:order.clientOrderId}));
  const {data:intentRaw,error:intentError}=await supabase.rpc("create_pacifica_execution_intent",{p_allocation_id:allocationId,p_idempotency_key:idempotencyKey,p_legs:intentLegs});
  if(intentError)return NextResponse.json({error:"THESIS could not persist the execution intent. No Pacifica order was submitted."},{status:409});
  const intent=intentSchema.safeParse(intentRaw);if(!intent.success)return NextResponse.json({error:"Execution intent response was invalid. Reconcile the saved allocation before retrying."},{status:202});
  if(intent.data.existing)return NextResponse.json({batchId:intent.data.batch_id,status:intent.data.status,filled:false,message:"This request key was already used. No duplicate order was sent."},{status:200});

  const record=async(status:"submitted"|"partial"|"rejected"|"submission_unknown",results:{client_order_id:string;status:"submitted"|"rejected";external_id:string|null}[]=[],providerError:string|null=null)=>supabase.rpc("record_pacifica_execution_results",{p_batch_id:intent.data.batch_id,p_status:status,p_provider_error:providerError,p_results:results});
  try{for(const order of orders)await setPacificaLeverage(order.symbol,Number(allocationRow.leverage));}
  catch(error){await record("rejected",orders.map(o=>({client_order_id:o.clientOrderId,status:"rejected" as const,external_id:null})),safePacificaMessage(error));return NextResponse.json({batchId:intent.data.batch_id,status:"rejected",filled:false,error:safePacificaMessage(error)},{status:422});}
  let results:Awaited<ReturnType<typeof submitPacificaMarketBatch>>;
  try{results=await submitPacificaMarketBatch(orders.map(o=>({symbol:o.symbol,side:o.side,quantity:o.quantity!,clientOrderId:o.clientOrderId,slippagePercent:"1",reduceOnly:false})));}
  catch(error){const message=safePacificaMessage(error);await record("submission_unknown",[],message);return NextResponse.json({batchId:intent.data.batch_id,status:"submission_unknown",filled:false,error:"Pacifica submission outcome is unknown. Do not retry; reconcile the testnet account first."},{status:202});}
  const normalized=results.map((result,i)=>({client_order_id:orders[i].clientOrderId,status:result.status==="accepted"?"submitted" as const:"rejected" as const,external_id:result.externalId??null}));
  const successes=results.filter(r=>r.status==="accepted").length,status=successes===results.length?"submitted":successes===0?"rejected":"partial";
  const {error:recordError}=await record(status,normalized,successes===results.length?null:"One or more Pacifica batch actions were rejected.");
  return NextResponse.json({batchId:intent.data.batch_id,status,filled:false,...(recordError?{reconciliationRequired:true,error:"Pacifica returned per-order results, but THESIS could not persist them. Do not retry this batch."}:{}),results:results.map((r,i)=>({symbol:orders[i].symbol,status:r.status,orderId:r.externalId??null,filled:false}))},{status:recordError?202:200});
}
