import type { Point } from "@/lib/types";
export interface MarketPriceProvider { getSeries(key:string, period:"1D"|"1W"|"1M"|"ALL"): Promise<Point[]> }
