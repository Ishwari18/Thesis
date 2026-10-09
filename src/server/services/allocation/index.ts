import Decimal from "decimal.js";
import { z } from "zod";
import type { Thesis } from "@/lib/types";
import type { ThesisAsset } from "@/lib/types";
import type { PacificaMarket, PacificaMarketQuote } from "@/server/providers/pacifica/types";

export const tradeInputSchema = z.object({ collateral: z.string().regex(/^\d+(\.\d{1,2})?$/), leverage: z.union([z.literal(2),z.literal(3),z.literal(5)]) });
export type AllocationLeg = { symbol: string; direction: "long"|"short"; weight: string; targetNotional: string; minimum: string; eligible: boolean; notional?:string; quantity?:string; reason?: string };
export type LiveAllocationContext={markets:PacificaMarket[];quotes:PacificaMarketQuote[];source:"pacifica-testnet"};
export function previewAllocation(thesis: Pick<Thesis,"assets">|{assets:Array<Pick<ThesisAsset,"symbol"|"weight"|"direction"|"active"|"maxLeverage"|"minNotional">>}, collateralInput: string, leverageInput: number, live?:LiveAllocationContext) {
  const parsed = tradeInputSchema.safeParse({ collateral: collateralInput, leverage: leverageInput });
  if (!parsed.success) return { valid: false, error: "Enter a valid collateral amount and choose 2x, 3x or 5x.", legs: [] as AllocationLeg[], exposure: "0" };
  const collateral = new Decimal(parsed.data.collateral), leverage = new Decimal(parsed.data.leverage);
  const totalWeight = thesis.assets.reduce((sum,a)=>sum.plus(a.weight),new Decimal(0));
  if (!totalWeight.eq(1)) return { valid:false, error:"Thesis target weights must sum to 100%.", legs:[] as AllocationLeg[], exposure:"0" };
  const now=Date.now(),maxMetadataAge=5*60_000,maxPriceAge=30_000;
  if(live){
    for(const asset of thesis.assets){
      const market=live.markets.find(m=>m.symbol===asset.symbol),quote=live.quotes.find(q=>q.symbol===asset.symbol);
      if(!market||!market.active||now-Date.parse(market.observedAt)>maxMetadataAge)return {valid:false,error:`${asset.symbol} is not listed or its Pacifica market metadata is missing or stale.`,legs:[] as AllocationLeg[],exposure:exposureFor(collateral,leverage),source:"pacifica-testnet" as const};
      if(parsed.data.leverage>market.maxLeverage)return {valid:false,error:`${asset.symbol} supports at most ${market.maxLeverage}x leverage on Pacifica.`,legs:[] as AllocationLeg[],exposure:exposureFor(collateral,leverage),source:"pacifica-testnet" as const};
      if(!quote||!quote.fresh||now-Date.parse(quote.observedAt)>maxPriceAge||!new Decimal(quote.markPrice).isFinite()||new Decimal(quote.markPrice).lte(0))return {valid:false,error:`${asset.symbol} is missing a fresh Pacifica mark price.`,legs:[] as AllocationLeg[],exposure:exposureFor(collateral,leverage),source:"pacifica-testnet" as const};
    }
  }else{
    const unavailable=thesis.assets.find(a=>!a.active||!a.minNotional||!Number.isFinite(a.maxLeverage)||parsed.data.leverage>a.maxLeverage);
    if(unavailable)return {valid:false,error:`${unavailable.symbol} is inactive or does not support ${parsed.data.leverage}x leverage.`,legs:[] as AllocationLeg[],exposure:"0",source:"demo" as const};
  }
  const exposure = collateral.mul(leverage);
  const legs = thesis.assets.map(a => {
    const raw = exposure.mul(a.weight);
    const market=live?.markets.find(m=>m.symbol===a.symbol),quote=live?.quotes.find(q=>q.symbol===a.symbol);
    const minimum=new Decimal(market?.minNotional??a.minNotional);
    let notional=raw.toDecimalPlaces(2,Decimal.ROUND_DOWN),quantity:string|undefined;
    if(market&&quote){const lot=new Decimal(market.lotSize),qty=new Decimal(raw).div(quote.markPrice).div(lot).floor().mul(lot);quantity=qty.toFixed(Math.max(0,(market.lotSize.split(".")[1]??"").length));notional=qty.mul(quote.markPrice).toDecimalPlaces(2,Decimal.ROUND_DOWN);}
    const eligible = notional.gte(minimum);
    return { symbol:a.symbol, direction:a.direction, weight:a.weight, targetNotional:raw.toDecimalPlaces(2,Decimal.ROUND_DOWN).toFixed(2), ...(quantity?{quantity}:{}), minimum:minimum.toFixed(2), notional:notional.toFixed(2), eligible, ...(eligible?{}:{reason:`Rounded notional ${notional.toFixed(2)} is below the ${minimum.toFixed(2)} market minimum`}) };
  });
  const blocked = legs.some(l=>!l.eligible);
  return { valid:!blocked, error:blocked?"One or more legs are below their market minimum after quantity rounding. Increase collateral or review the allocation.":undefined, collateral:collateral.toFixed(2), leverage:leverage.toString(), exposure:exposure.toFixed(2), legs, mode:"STRICT" as const, source:live?"pacifica-testnet" as const:"demo" as const, feeNote:"Estimated exposure excludes fees, margin reserve and execution rounding." };
}
function exposureFor(collateral:Decimal,leverage:Decimal){return collateral.mul(leverage).toFixed(2);}
export function minimumCollateral(minimum: string, leverage: number, weight: string) { return new Decimal(minimum).div(new Decimal(leverage).mul(weight)).toDecimalPlaces(2, Decimal.ROUND_UP).toFixed(2); }
