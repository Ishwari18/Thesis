export const PERIODS = ["1D", "1W", "1M", "ALL"] as const;
export type ChartPeriod = typeof PERIODS[number];
export type ChartPoint = { timestamp: number; value: number };
export type ChartPlotPoint = { timestamp: number; value: number | null };

export const PERIOD_INTERVAL: Record<ChartPeriod, string> = {
  "1D": "1m",
  "1W": "15m",
  "1M": "1h",
  ALL: "1d",
};

export const PERIOD_MS: Record<Exclude<ChartPeriod, "ALL">, number> = {
  "1D": 24 * 60 * 60_000,
  "1W": 7 * 24 * 60 * 60_000,
  "1M": 30 * 24 * 60 * 60_000,
};
const INTERVAL_MS: Record<ChartPeriod, number> = {
  "1D": 60_000,
  "1W": 15 * 60_000,
  "1M": 60 * 60_000,
  ALL: 24 * 60 * 60_000,
};

export function periodStart(period: ChartPeriod, now = Date.now()) {
  return period === "ALL" ? 0 : now - PERIOD_MS[period];
}

export function normalizePoints(points: ChartPoint[]): ChartPoint[] {
  const byTimestamp = new Map<number, ChartPoint>();
  for (const point of points) {
    if (!Number.isFinite(point.timestamp) || !Number.isFinite(point.value) || point.value <= 0) continue;
    byTimestamp.set(point.timestamp, point);
  }
  return [...byTimestamp.values()].sort((a, b) => a.timestamp - b.timestamp);
}

export function mergeLivePrice(points: ChartPoint[], point: ChartPoint): ChartPoint[] {
  return normalizePoints([...points, point]);
}

export function addMissingCandleBreaks(points: ChartPoint[], period: ChartPeriod): ChartPlotPoint[] {
  const sorted = normalizePoints(points);
  const interval = INTERVAL_MS[period];
  const result: ChartPlotPoint[] = [];
  for (let index = 0; index < sorted.length; index += 1) {
    const point = sorted[index];
    if (index > 0 && point.timestamp - sorted[index - 1].timestamp > interval * 1.5) {
      // A null sample breaks the SVG path at an actual candle slot. It carries no price.
      result.push({ timestamp: sorted[index - 1].timestamp + interval, value: null });
    }
    result.push(point);
  }
  return result;
}

export function isPriceStale(observedAt: number | null, now = Date.now(), maxAgeMs = 30_000) {
  return observedAt === null || now - observedAt > maxAgeMs || observedAt - now > 5_000;
}
