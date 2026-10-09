import "server-only";
import { fetchPacificaSnapshot } from "@/server/providers/pacifica/market-data";
import type { MarketMetadata, MarketMetadataProvider } from "./types";
export const pacificaMetadataProvider:MarketMetadataProvider={async getMarket(symbol):Promise<MarketMetadata|undefined>{const data=await fetchPacificaSnapshot();const m=data.markets.find(x=>x.symbol===symbol);return m?{symbol:m.symbol,active:m.active,minNotional:m.minNotional,quantityPrecision:(m.lotSize.split(".")[1]??"").length,pricePrecision:(m.tickSize.split(".")[1]??"").length,maxLeverage:m.maxLeverage,observedAt:m.observedAt,lotSize:m.lotSize,maxNotional:m.maxNotional,source:m.source}:undefined;}};
