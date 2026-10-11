import Decimal from "decimal.js";
/** P&L sign convention: positive quantity is long, negative is short. P&L = signed quantity × (mark − entry). */
export function unrealizedPnl(quantity: string, entryPrice: string, markPrice: string) { return new Decimal(quantity).mul(new Decimal(markPrice).minus(entryPrice)); }
export function realizedPnl(direction: "long" | "short", entryPrice: string, exitPrice: string, quantity: string, openFees: string, closeFees: string) {
  const sign = direction === "long" ? 1 : -1;
  return new Decimal(exitPrice).minus(entryPrice).mul(quantity).mul(sign).minus(openFees).minus(closeFees);
}
export function netPnl(realized: string, unrealized: string, fees: string, funding: string) { return new Decimal(realized).plus(unrealized).minus(fees).plus(funding); }
