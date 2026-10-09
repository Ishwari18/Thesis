import Decimal from "decimal.js";
import { z } from "zod";
import type { Thesis } from "@/lib/types";

export const tradeInputSchema = z.object({ collateral: z.string().regex(/^\d+(\.\d{1,2})?$/), leverage: z.union([z.literal(2),z.literal(3),z.literal(5)]) });
export type AllocationLeg = { symbol: string; direction: "long"|"short"; weight: string; targetNotional: string; minimum: string; eligible: boolean; reason?: string };
export function previewAllocation(thesis: Thesis, collateralInput: string, leverageInput: number) {
  const parsed = tradeInputSchema.safeParse({ collateral: collateralInput, leverage: leverageInput });
  if (!parsed.success) return { valid: false, error: "Enter a valid collateral amount and choose 2x, 3x or 5x.", legs: [] as AllocationLeg[], exposure: "0" };
  const collateral = new Decimal(parsed.data.collateral), leverage = new Decimal(parsed.data.leverage);
  const totalWeight = thesis.assets.reduce((sum,a)=>sum.plus(a.weight),new Decimal(0));
  if (!totalWeight.eq(1)) return { valid:false, error:"Thesis target weights must sum to 100%.", legs:[] as AllocationLeg[], exposure:"0" };
  const now = Date.now(), maxAgeMs = 24 * 60 * 60 * 1000;
  const unavailable = thesis.assets.find(a => !a.active || !a.metadataObservedAt || !a.minNotional || now - Date.parse(a.metadataObservedAt) > maxAgeMs || !Number.isFinite(a.maxLeverage) || parsed.data.leverage > a.maxLeverage);
  if (unavailable) return { valid:false, error:`${unavailable.symbol} is inactive or its market metadata is missing, stale, or does not support ${parsed.data.leverage}x leverage.`, legs:[] as AllocationLeg[], exposure:"0" };
  const exposure = collateral.mul(leverage);
  const legs = thesis.assets.map(a => {
    const raw = exposure.mul(a.weight);
    const notional = raw.toDecimalPlaces(2, Decimal.ROUND_DOWN);
    const minimum = new Decimal(a.minNotional);
    const eligible = notional.gte(minimum);
    return { symbol:a.symbol, direction:a.direction, weight:a.weight, targetNotional:notional.toFixed(2), minimum:minimum.toFixed(2), eligible, ...(eligible?{}:{reason:`Below ${minimum.toFixed(2)} market minimum`}) };
  });
  const blocked = legs.some(l=>!l.eligible);
  return { valid:!blocked, error:blocked?"One or more legs are below their market minimum. Increase collateral or review the allocation.":undefined, collateral:collateral.toFixed(2), leverage:leverage.toString(), exposure:exposure.toFixed(2), legs, mode:"STRICT" as const, feeNote:"Estimated exposure excludes fees, margin reserve and execution rounding." };
}
export function minimumCollateral(minimum: string, leverage: number, weight: string) { return new Decimal(minimum).div(new Decimal(leverage).mul(weight)).toDecimalPlaces(2, Decimal.ROUND_UP).toFixed(2); }
