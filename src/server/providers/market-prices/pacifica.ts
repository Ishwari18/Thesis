import "server-only";
import { fetchPacificaSnapshot } from "@/server/providers/pacifica/market-data";
import type { PacificaMarketQuote } from "@/server/providers/pacifica/types";
export type MarketQuoteProvider={getQuote(symbol:string):Promise<PacificaMarketQuote|undefined>};
export const pacificaPriceProvider:MarketQuoteProvider={async getQuote(symbol){const snapshot=await fetchPacificaSnapshot();return snapshot.quotes.find(q=>q.symbol===symbol);}};
