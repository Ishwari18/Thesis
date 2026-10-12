import { describe, expect, it } from "vitest";
import { calculateThesisPnl, type ThesisPerformanceLeg } from "./thesis-performance";

const leg = (overrides: Partial<ThesisPerformanceLeg> = {}): ThesisPerformanceLeg => ({ symbol: "BTC", direction: "long", remainingQuantity: "2", entryPrice: "100", realizedPnl: "0", openFeesRemaining: "1", feesPaid: "1", funding: "0", ...overrides });
const mark = (price: string, timestamp = 100_000) => new Map([["BTC", { price, timestamp }]]);

describe("thesis net P&L", () => {
  it("aggregates multiple long and short legs using actual quantities, without applying leverage twice", () => {
    const legs = [leg({ leverage: 5 }), leg({ symbol: "ETH", direction: "short", remainingQuantity: "3", entryPrice: "50", openFeesRemaining: "0.5", leverage: 3 })];
    const marks = new Map([["BTC", { price: "110", timestamp: 100_000 }], ["ETH", { price: "45", timestamp: 100_000 }]]);
    const result = calculateThesisPnl(legs, marks, 100_000);
    expect(result.unrealizedPnl).toBe("33.5");
    expect(result.value).toBe("33.5");
  });

  it("keeps realized and unrealized separate and includes fees and funding once", () => {
    const result = calculateThesisPnl([leg({ realizedPnl: "8", openFeesRemaining: "2", feesPaid: "5", funding: "-1" })], mark("103"), 100_000);
    expect(result.realizedPnl).toBe("8"); expect(result.unrealizedPnl).toBe("4");
    expect(result.fees).toBe("5"); expect(result.funding).toBe("-1"); expect(result.value).toBe("11");
  });

  it("allows closed positions without a mark and rejects missing or stale open marks", () => {
    expect(calculateThesisPnl([leg({ remainingQuantity: "0", realizedPnl: "9" })], new Map(), 100_000).value).toBe("9");
    expect(calculateThesisPnl([leg()], new Map(), 100_000).value).toBeNull();
    expect(calculateThesisPnl([leg()], mark("101", 1), 100_000).value).toBeNull();
  });

  it("aligns the aggregate at the newest constituent observation and rejects future stale marks", () => {
    const legs = [leg(), leg({ symbol: "ETH", entryPrice: "40" })];
    const marks = new Map([["BTC", { price: "101", timestamp: 99_000 }], ["ETH", { price: "41", timestamp: 100_000 }]]);
    expect(calculateThesisPnl(legs, marks, 100_000).asOf).toBe(100_000);
    expect(calculateThesisPnl([leg()], mark("101", 110_000), 100_000).value).toBeNull();
  });
});
