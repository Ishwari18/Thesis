export type Direction = "long" | "short";
export type ThesisAsset = { symbol: string; weight: string; direction: Direction; color: string; minNotional: string; qtyPrecision: number; active: boolean; maxLeverage: number; metadataObservedAt: string };
export type Point = { date: string; value: number };
export type Thesis = { slug: string; name: string; category: string; summary: string; idea: string; horizon: string; risk: string; color: string; initials: string; allTime: number; published: string; assets: ThesisAsset[]; series: Point[]; tracks?: string; rebalancing?: string; posture?: string; leverageModel?: string; coverage?: string; mandate: string };
