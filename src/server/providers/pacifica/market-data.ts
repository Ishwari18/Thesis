import "server-only";
import { envelopeSchema, marketInfoSchema, priceSchema, type PacificaMarket, type PacificaMarketQuote, type PacificaSnapshot } from "./types";
import { createPacificaClient, type PacificaClient } from "./client";
import { readPacificaConfig, requireMarketDataConfig } from "./config";
import { PacificaError } from "./errors";

const MARKET_TTL=5*60_000, PRICE_TTL=10_000, MAX_PRICE_AGE=30_000;
let cachedMarkets:{at:number;rows:PacificaMarket[]}|undefined;
let cachedQuotes:{at:number;rows:PacificaMarketQuote[]}|undefined;
let inflight:Promise<PacificaSnapshot>|undefined;
function getData<T>(raw:unknown,path:string,parse:(item:unknown)=>T[]):T[]{const envelope=envelopeSchema.safeParse(raw);if(!envelope.success||!envelope.data.success||!Array.isArray(envelope.data.data))throw new PacificaError("response",`Pacifica ${path} response was invalid.`);return envelope.data.data.map((x)=>{const row=parse(x);if(row.length!==1)throw new PacificaError("response",`Pacifica ${path} response contained invalid market data.`);return row[0];});}
export async function fetchPacificaSnapshot(client:PacificaClient=createPacificaClient(),now=Date.now()):Promise<PacificaSnapshot>{
  requireMarketDataConfig(readPacificaConfig());
  if(inflight)return inflight;
  if(cachedMarkets&&cachedQuotes&&now-cachedMarkets.at<MARKET_TTL&&now-cachedQuotes.at<PRICE_TTL) return {markets:cachedMarkets.rows,quotes:cachedQuotes.rows,observedAt:new Date(Math.max(cachedMarkets.at,cachedQuotes.at)).toISOString(),source:"pacifica-testnet"};
  inflight=(async()=>{
    const [mRaw,pRaw]=await Promise.all([client.get<unknown>("/api/v1/info"),client.get<unknown>("/api/v1/info/prices")]);
    const marketRows=getData(mRaw,"market info",x=>{const p=marketInfoSchema.safeParse(x);return p.success?[p.data]:[];});
    const priceRows=getData(pRaw,"prices",x=>{const p=priceSchema.safeParse(x);return p.success?[p.data]:[];});
    const observedAt=new Date(now).toISOString();
    const markets=marketRows.map((m)=>({symbol:m.symbol,exchangeId:m.symbol,active:m.instrument_type==="perpetual",instrumentType:m.instrument_type,minNotional:m.min_order_size,...(m.max_order_size?{maxNotional:m.max_order_size}:{}),lotSize:m.lot_size,tickSize:m.tick_size,maxLeverage:m.max_leverage,observedAt,source:"pacifica-testnet" as const}));
    const quotes=priceRows.map((p)=>({symbol:p.symbol,markPrice:p.mark,...(p.mid?{midPrice:p.mid}:{}),...(p.oracle?{oraclePrice:p.oracle}:{}),observedAt:new Date(p.timestamp).toISOString(),fresh:now-p.timestamp>=0&&now-p.timestamp<=MAX_PRICE_AGE,...(p.funding?{fundingRate:p.funding}:{}),...(p.next_funding?{nextFundingRate:p.next_funding}:{}),source:"pacifica-testnet" as const}));
    cachedMarkets={at:now,rows:markets};cachedQuotes={at:now,rows:quotes};return {markets,quotes,observedAt,source:"pacifica-testnet" as const};
  })();
  try{return await inflight;}finally{inflight=undefined;}
}
export function resetPacificaMarketCache(){cachedMarkets=undefined;cachedQuotes=undefined;inflight=undefined;}
