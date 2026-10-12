import "server-only";
import { z } from "zod";
import { createPacificaClient, type PacificaClient } from "./client";
import { PacificaError } from "./errors";
import type { ChartPoint } from "@/lib/market-chart";
import { normalizePoints } from "@/lib/market-chart";

const candleSchema = z.object({ t: z.number(), c: z.string() }).passthrough();
const responseSchema = z.object({ success: z.boolean(), data: z.array(z.unknown()) }).passthrough();

export async function getPacificaMarkCandles(options: {
  symbol: string;
  interval: string;
  startTime: number;
  endTime?: number;
  client?: PacificaClient;
}): Promise<ChartPoint[]> {
  const client = options.client ?? createPacificaClient();
  const raw = await client.get<unknown>("/api/v1/kline/mark", {
    symbol: options.symbol,
    interval: options.interval,
    start_time: String(options.startTime),
    ...(options.endTime ? { end_time: String(options.endTime) } : {}),
  });
  const response = responseSchema.safeParse(raw);
  if (!response.success || !response.data.success) {
    throw new PacificaError("response", "Pacifica candle response was invalid.");
  }
  const points = response.data.data.flatMap((item) => {
    const candle = candleSchema.safeParse(item);
    if (!candle.success) return [];
    const value = Number(candle.data.c);
    return Number.isFinite(value) && value > 0 ? [{ timestamp: candle.data.t, value }] : [];
  });
  return normalizePoints(points);
}
