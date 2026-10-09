export type MarketMetadata = { symbol:string; active:boolean; minNotional:string; quantityPrecision:number; pricePrecision:number; maxLeverage:number; observedAt:string; lotSize?:string; maxNotional?:string; source?:"demo"|"pacifica-testnet" };
export interface MarketMetadataProvider { getMarket(symbol:string): Promise<MarketMetadata|undefined> }
