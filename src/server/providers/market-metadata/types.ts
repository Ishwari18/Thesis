export type MarketMetadata = { symbol:string; active:boolean; minNotional:string; quantityPrecision:number; pricePrecision:number; maxLeverage:number; observedAt:string };
export interface MarketMetadataProvider { getMarket(symbol:string): Promise<MarketMetadata|undefined> }
