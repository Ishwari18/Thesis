import type { MarketMetadata, MarketMetadataProvider } from "./types";
import { theses } from "@/server/services/theses/demo";
const entries = new Map(theses.flatMap(t=>t.assets.map(a=>[a.symbol,{symbol:a.symbol,active:true,minNotional:a.minNotional,quantityPrecision:a.qtyPrecision,pricePrecision:2,maxLeverage:5,observedAt:"2026-10-09T00:00:00.000Z",lotSize:"0.0001",source:"demo" as const} satisfies MarketMetadata])));
export const demoMetadataProvider: MarketMetadataProvider = { async getMarket(symbol) { return entries.get(symbol); } };
