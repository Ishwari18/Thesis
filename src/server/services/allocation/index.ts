import Decimal from "decimal.js";
import { z } from "zod";
import type { Thesis, ThesisAsset } from "@/lib/types";
import type {
  PacificaMarket,
  PacificaMarketQuote,
} from "@/server/providers/pacifica/types";

export const tradeInputSchema = z.object({
  collateral: z.string().regex(/^\d+(\.\d{1,2})?$/),
  leverage: z.union([z.literal(2), z.literal(3), z.literal(5)]),
});

export type AllocationLeg = {
  symbol: string;
  direction: "long" | "short";
  weight: string;
  targetNotional: string;
  minimum: string;
  eligible: boolean;
  notional?: string;
  quantity?: string;
  reason?: string;
};

export type LiveAllocationContext = {
  markets: PacificaMarket[];
  quotes: PacificaMarketQuote[];
  source: "pacifica-testnet";
};

type Asset = Pick<
  ThesisAsset,
  | "symbol"
  | "weight"
  | "direction"
  | "active"
  | "maxLeverage"
  | "minNotional"
>;

function exposureFor(collateral: Decimal, leverage: Decimal) {
  return collateral.mul(leverage).toFixed(2);
}

function freshTimestamp(
  timestamp: string,
  maxAgeMs: number,
  now: number,
): boolean {
  const parsed = Date.parse(timestamp);
  const age = now - parsed;
  return Number.isFinite(parsed) && age >= 0 && age <= maxAgeMs;
}

export function previewAllocation(
  thesis: Pick<Thesis, "assets"> | { assets: Asset[] },
  collateralInput: string,
  leverageInput: number,
  live?: LiveAllocationContext,
) {
  const parsed = tradeInputSchema.safeParse({
    collateral: collateralInput,
    leverage: leverageInput,
  });

  if (!parsed.success) {
    return {
      valid: false,
      error: "Enter a valid collateral amount and choose 2x, 3x or 5x.",
      legs: [] as AllocationLeg[],
      exposure: "0.00",
    };
  }

  const collateral = new Decimal(parsed.data.collateral);
  const leverage = new Decimal(parsed.data.leverage);
  const exposure = collateral.mul(leverage);
  const exposureText = exposure.toFixed(2);

  const totalWeight = thesis.assets.reduce(
    (sum, asset) => sum.plus(asset.weight),
    new Decimal(0),
  );

  if (
    thesis.assets.length === 0 ||
    !totalWeight.isFinite() ||
    !totalWeight.eq(1)
  ) {
    return {
      valid: false,
      error: "Thesis target weights must sum to 100%.",
      legs: [] as AllocationLeg[],
      exposure: exposureText,
    };
  }

  const now = Date.now();
  const maxMetadataAge = 5 * 60_000;
  const maxPriceAge = 30_000;

  const legs: AllocationLeg[] = thesis.assets.map((asset) => {
    const raw = exposure.mul(asset.weight);
    const targetNotional = raw.toDecimalPlaces(
      2,
      Decimal.ROUND_DOWN,
    ).toFixed(2);

    const market = live?.markets.find(
      (item) => item.symbol === asset.symbol,
    );
    const quote = live?.quotes.find(
      (item) => item.symbol === asset.symbol,
    );

    const minimumValue = market?.minNotional || asset.minNotional || "0";

    const base = {
      symbol: asset.symbol,
      direction: asset.direction,
      weight: asset.weight,
      targetNotional,
      minimum: new Decimal(minimumValue).toFixed(2),
    };

    if (!asset.active) {
      return {
        ...base,
        eligible: false,
        reason: "This constituent is inactive in the thesis.",
      };
    }

    if (!live) {
      if (
        !Number.isFinite(asset.maxLeverage) ||
        parsed.data.leverage > asset.maxLeverage
      ) {
        return {
          ...base,
          eligible: false,
          reason: `Configured leverage limit is below ${parsed.data.leverage}x.`,
        };
      }

      if (!asset.minNotional) {
        return {
          ...base,
          eligible: false,
          reason: "Market minimum is unknown; live market data is required.",
        };
      }

      const eligible = raw.gte(base.minimum);

      return {
        ...base,
        notional: targetNotional,
        eligible,
        ...(!eligible
          ? { reason: `Target notional is below the $${base.minimum} minimum.` }
          : {}),
      };
    }

    if (!market) {
      return {
        ...base,
        eligible: false,
        reason: "Market is not returned by Pacifica.",
      };
    }

    if (!market.active) {
      return {
        ...base,
        eligible: false,
        reason: "Pacifica reports this market as inactive.",
      };
    }

    if (
      !freshTimestamp(market.observedAt, maxMetadataAge, now)
    ) {
      return {
        ...base,
        eligible: false,
        reason: "Pacifica market metadata is stale or has an invalid timestamp.",
      };
    }

    if (parsed.data.leverage > market.maxLeverage) {
      return {
        ...base,
        eligible: false,
        reason: `Pacifica supports at most ${market.maxLeverage}x leverage.`,
      };
    }

    if (!quote) {
      return {
        ...base,
        eligible: false,
        reason: "No Pacifica price quote is available.",
      };
    }

    if (!quote.fresh || !freshTimestamp(quote.observedAt, maxPriceAge, now)) {
      return {
        ...base,
        eligible: false,
        reason: "Pacifica price quote is stale or has an invalid timestamp.",
      };
    }

    let markPrice: Decimal;

    try {
      markPrice = new Decimal(quote.markPrice);
    } catch {
      return {
        ...base,
        eligible: false,
        reason: "Pacifica returned an invalid mark price.",
      };
    }

    if (!markPrice.isFinite() || markPrice.lte(0)) {
      return {
        ...base,
        eligible: false,
        reason: "Pacifica returned an invalid mark price.",
      };
    }

    let lot: Decimal;

    try {
      lot = new Decimal(market.lotSize);
    } catch {
      return {
        ...base,
        eligible: false,
        reason: "Pacifica returned an invalid lot size.",
      };
    }

    if (!lot.isFinite() || lot.lte(0)) {
      return {
        ...base,
        eligible: false,
        reason: "Pacifica returned an invalid lot size.",
      };
    }

    const quantity = raw.div(markPrice).div(lot)
      .floor()
      .mul(lot);

    const quantityPrecision = Math.max(
      0,
      (market.lotSize.split(".")[1] ?? "").length,
    );

    const quantityText = quantity.toFixed(quantityPrecision);
    const notional = quantity.mul(markPrice).toDecimalPlaces(
      2,
      Decimal.ROUND_DOWN,
    );
    const eligible = notional.gte(base.minimum) && quantity.gt(0);

    return {
      ...base,
      quantity: quantityText,
      notional: notional.toFixed(2),
      eligible,
      ...(!eligible
        ? {
            reason: `Executable notional $${notional.toFixed(2)} is below the $${base.minimum} minimum after lot rounding.`,
          }
        : {}),
    };
  });

  const blocked = legs.filter((leg) => !leg.eligible);

  return {
    valid: blocked.length === 0,
    error:
      blocked.length > 0
        ? `${blocked.length} of ${legs.length} legs cannot be traded. Review the warnings below.`
        : undefined,
    collateral: collateral.toFixed(2),
    leverage: leverage.toString(),
    exposure: exposureText,
    legs,
    mode: "STRICT" as const,
    source: live ? ("pacifica-testnet" as const) : ("demo" as const),
    feeNote:
      "Estimated exposure excludes fees, margin reserve and execution rounding.",
  };
}

export function minimumCollateral(
  minimum: string,
  leverage: number,
  weight: string,
) {
  return new Decimal(minimum)
    .div(new Decimal(leverage).mul(weight))
    .toDecimalPlaces(2, Decimal.ROUND_UP)
    .toFixed(2);
}
