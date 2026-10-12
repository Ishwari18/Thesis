import { describe, expect, it } from "vitest";
import { addMissingCandleBreaks, isPriceStale, mergeLivePrice, normalizePoints, PERIOD_INTERVAL, periodStart } from "./market-chart";

describe("market chart data pipeline", () => {
  it("maps each requested period to a documented Pacifica interval", () => {
    expect(PERIOD_INTERVAL).toEqual({ "1D": "1m", "1W": "15m", "1M": "1h", ALL: "1d" });
  });

  it("uses actual rolling timestamps and requests all available history for ALL", () => {
    expect(periodStart("1D", 100_000)).toBe(100_000 - 24 * 60 * 60_000);
    expect(periodStart("1W", 100_000)).toBe(100_000 - 7 * 24 * 60 * 60_000);
    expect(periodStart("1M", 100_000)).toBe(100_000 - 30 * 24 * 60 * 60_000);
    expect(periodStart("ALL", 100_000)).toBe(0);
  });

  it("sorts timestamps and keeps the last valid observation for duplicates", () => {
    expect(normalizePoints([
      { timestamp: 3, value: 30 }, { timestamp: 1, value: 10 },
      { timestamp: 3, value: 31 }, { timestamp: 2, value: Number.NaN },
    ])).toEqual([{ timestamp: 1, value: 10 }, { timestamp: 3, value: 31 }]);
  });

  it("merges live prices by timestamp without inventing missing candles", () => {
    expect(mergeLivePrice([{ timestamp: 1, value: 10 }, { timestamp: 3, value: 12 }], { timestamp: 2, value: 11 }))
      .toEqual([{ timestamp: 1, value: 10 }, { timestamp: 2, value: 11 }, { timestamp: 3, value: 12 }]);
  });

  it("breaks the drawn line across missing candles without filling in prices", () => {
    expect(addMissingCandleBreaks([
      { timestamp: 0, value: 10 }, { timestamp: 3 * 60_000, value: 12 },
    ], "1D")).toEqual([
      { timestamp: 0, value: 10 }, { timestamp: 60_000, value: null }, { timestamp: 3 * 60_000, value: 12 },
    ]);
  });

  it("marks absent or old market data stale", () => {
    expect(isPriceStale(null, 100_000)).toBe(true);
    expect(isPriceStale(60_000, 100_000)).toBe(true);
    expect(isPriceStale(95_000, 100_000)).toBe(false);
  });
});
