import Decimal from "decimal.js";

export type ThesisPerformanceLeg = { symbol: string; direction: "long" | "short"; remainingQuantity: string; entryPrice: string | null; realizedPnl: string; openFeesRemaining: string; feesPaid: string; funding: string; leverage?: number };
export type ThesisMark = { price: string; timestamp: number };
export type ThesisPnl = { value: string | null; realizedPnl: string; unrealizedPnl: string | null; fees: string; funding: string; asOf: number | null; missingSymbols: string[] };

export function calculateThesisPnl(legs: ThesisPerformanceLeg[], marks: Map<string, ThesisMark>, now = Date.now(), maxMarkAgeMs = 30_000): ThesisPnl {
  let realized = new Decimal(0), unrealized = new Decimal(0), fees = new Decimal(0), funding = new Decimal(0);
  let asOf: number | null = null, complete = true;
  const missingSymbols = new Set<string>();
  for (const leg of legs) {
    const quantity = new Decimal(leg.remainingQuantity);
    realized = realized.plus(leg.realizedPnl); fees = fees.plus(leg.feesPaid); funding = funding.plus(leg.funding);
    if (quantity.lte(0)) continue;
    const mark = marks.get(leg.symbol);
    if (!mark || mark.timestamp > now + 5_000 || now - mark.timestamp > maxMarkAgeMs || !leg.entryPrice) {
      complete = false; missingSymbols.add(leg.symbol); continue;
    }
    const sign = leg.direction === "long" ? 1 : -1;
    unrealized = unrealized.plus(quantity.mul(new Decimal(mark.price).minus(leg.entryPrice)).mul(sign).minus(leg.openFeesRemaining));
    asOf = asOf === null ? mark.timestamp : Math.max(asOf, mark.timestamp);
  }
  return { value: complete ? realized.plus(unrealized).plus(funding).toString() : null, realizedPnl: realized.toString(), unrealizedPnl: complete ? unrealized.toString() : null, fees: fees.toString(), funding: funding.toString(), asOf, missingSymbols: [...missingSymbols].sort() };
}
