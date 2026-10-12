import Decimal from "decimal.js";
import type { ChartPoint } from "./market-chart";

export type ThesisIndexConstituent = { symbol: string; weight: string; direction: "long" | "short" };
export type ThesisIndexMark = { price: string; timestamp: number };
export type ThesisIndex = { points: ChartPoint[]; basePrices: Record<string, string>; missingSymbols: string[] };
export type ThesisIndexValue = { value: number | null; timestamp: number | null; missingSymbols: string[] };

export function normalizeThesisIndexPoints(points: ChartPoint[]): ChartPoint[] {
  const byTimestamp = new Map<number, ChartPoint>();
  for (const point of points) {
    if (Number.isFinite(point.timestamp) && Number.isFinite(point.value)) byTimestamp.set(point.timestamp, point);
  }
  return [...byTimestamp.values()].sort((a, b) => a.timestamp - b.timestamp);
}

export function buildWeightedThesisIndex(candlesBySymbol: Map<string, ChartPoint[]>, basket: ThesisIndexConstituent[]): ThesisIndex {
  if (!basket.length) return { points: [], basePrices: {}, missingSymbols: [] };
  const bySymbol = basket.map(({ symbol }) => {
    const points = new Map<number, number>();
    for (const point of candlesBySymbol.get(symbol) ?? []) {
      if (Number.isFinite(point.timestamp) && Number.isFinite(point.value) && point.value > 0) points.set(point.timestamp, point.value);
    }
    return { symbol, points };
  });
  const missingSymbols = bySymbol.filter((item) => item.points.size === 0).map((item) => item.symbol);
  if (missingSymbols.length) return { points: [], basePrices: {}, missingSymbols };
  const timestamps = [...bySymbol[0].points.keys()].filter((timestamp) => bySymbol.every((item) => item.points.has(timestamp))).sort((a, b) => a - b);
  if (!timestamps.length) return { points: [], basePrices: {}, missingSymbols: basket.map((item) => item.symbol) };
  const first = timestamps[0];
  const basePrices = Object.fromEntries(bySymbol.map((item) => [item.symbol, String(item.points.get(first)!)]));
  const points = normalizeThesisIndexPoints(timestamps.map((timestamp) => {
    let value = new Decimal(0);
    for (const constituent of basket) {
      const price = bySymbol.find((item) => item.symbol === constituent.symbol)!.points.get(timestamp)!;
      const base = new Decimal(basePrices[constituent.symbol]);
      const sign = constituent.direction === "long" ? 1 : -1;
      const contribution = new Decimal(price).div(base).minus(1).mul(constituent.weight).mul(sign).mul(100);
      value = value.plus(contribution);
    }
    return { timestamp, value: Number(value.toString()) };
  }));
  return { points, basePrices, missingSymbols: [] };
}

export function calculateWeightedThesisReturn(
  basket: ThesisIndexConstituent[],
  basePrices: Record<string, string>,
  marks: Map<string, ThesisIndexMark>,
  now = Date.now(),
  maxAgeMs = 30_000,
): ThesisIndexValue {
  let value = new Decimal(0), timestamp: number | null = null;
  const missingSymbols: string[] = [];
  for (const constituent of basket) {
    const mark = marks.get(constituent.symbol);
    if (!mark || mark.timestamp > now + 5_000 || now - mark.timestamp > maxAgeMs || !basePrices[constituent.symbol]) {
      missingSymbols.push(constituent.symbol); continue;
    }
    const sign = constituent.direction === "long" ? 1 : -1;
    value = value.plus(new Decimal(mark.price).div(basePrices[constituent.symbol]).minus(1).mul(constituent.weight).mul(sign).mul(100));
    timestamp = timestamp === null ? mark.timestamp : Math.max(timestamp, mark.timestamp);
  }
  return missingSymbols.length ? { value: null, timestamp, missingSymbols } : { value: Number(value.toString()), timestamp, missingSymbols };
}
