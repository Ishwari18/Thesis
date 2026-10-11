
import { describe, expect, it } from "vitest";
import { previewAllocation, minimumCollateral } from "./index";
import { unrealizedPnl, netPnl } from "../portfolio/pnl";
import type { Thesis } from "@/lib/types";

const allocationTestThesis = {
  slug: "allocation-test",
  name: "Allocation Test",
  assets: [
    {
      symbol: "NVDA",
      weight: "0.45",
      direction: "long" as const,
      active: true,
      maxLeverage: 5,
      minNotional: "10",
    },
    {
      symbol: "AMD",
      weight: "0.30",
      direction: "long" as const,
      active: true,
      maxLeverage: 5,
      minNotional: "10",
    },
    {
      symbol: "AVGO",
      weight: "0.25",
      direction: "long" as const,
      active: true,
      maxLeverage: 5,
      minNotional: "10",
    },
  ],
} as Thesis;

describe("decimal-safe allocation preview", () => {
  it("computes total and per-market notional for selected leverage", () => {
    const preview = previewAllocation(allocationTestThesis, "100", 3);

    expect(preview.exposure).toBe("300.00");
    expect(preview.legs.map((leg) => leg.targetNotional)).toEqual([
      "135.00",
      "90.00",
      "75.00",
    ]);
    expect(preview.valid).toBe(true);
  });

  it("blocks a leg that does not meet its own metadata minimum", () => {
    const preview = previewAllocation(allocationTestThesis, "10", 2);

    expect(preview.valid).toBe(false);
    expect(preview.legs.some((leg) => !leg.eligible)).toBe(true);
  });

  it("calculates minimum collateral with decimal arithmetic", () => {
    expect(minimumCollateral("10", 3, "0.25")).toBe("13.34");
  });

  it("rejects an unsupported leverage value", () => {
    expect(previewAllocation(allocationTestThesis, "100", 4).valid).toBe(
      false,
    );
  });

  it("blocks an inactive constituent", () => {
    const thesis = {
      ...allocationTestThesis,
      assets: allocationTestThesis.assets.map((asset, index) =>
        index === 0 ? { ...asset, active: false } : asset,
      ),
    };

    expect(previewAllocation(thesis, "100", 3).valid).toBe(false);
  });
});

describe("thesis accounting formulas", () => {
  it("uses signed quantity for long and short unrealized P&L", () => {
    expect(unrealizedPnl("2", "100", "110").toFixed(2)).toBe("20.00");
    expect(unrealizedPnl("-2", "100", "110").toFixed(2)).toBe("-20.00");
  });

  it("subtracts fees and adds signed funding cashflow", () => {
    expect(netPnl("5", "20", "2", "-1").toFixed(2)).toBe("22.00");
  });
});