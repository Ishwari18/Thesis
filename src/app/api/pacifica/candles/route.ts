import { NextResponse } from "next/server";
import { PERIOD_INTERVAL, PERIODS, periodStart } from "@/lib/market-chart";
import { getPacificaMarkCandles } from "@/server/providers/pacifica/candles";
import { readPacificaConfig } from "@/server/providers/pacifica/config";
import { fetchPacificaSnapshot } from "@/server/providers/pacifica/market-data";
import { safePacificaMessage } from "@/server/providers/pacifica/errors";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const symbol = params.get("symbol") ?? "";
  const period = params.get("period");
  if (!/^[A-Z0-9]+$/.test(symbol) || !PERIODS.includes(period as typeof PERIODS[number])) {
    return NextResponse.json({ message: "A valid market and period are required." }, { status: 400 });
  }

  const config = readPacificaConfig();
  if (!config.marketDataEnabled) {
    return NextResponse.json({ message: "Pacifica testnet market data is disabled." }, { status: 503 });
  }

  try {
    const snapshot = await fetchPacificaSnapshot();
    if (!snapshot.markets.some((market) => market.symbol === symbol)) {
      return NextResponse.json({ message: "This market is unavailable on the configured Pacifica environment." }, { status: 404 });
    }
    const candles = await getPacificaMarkCandles({
      symbol,
      interval: PERIOD_INTERVAL[period as typeof PERIODS[number]],
      startTime: periodStart(period as typeof PERIODS[number]),
    });
    return NextResponse.json({
      symbol,
      period,
      interval: PERIOD_INTERVAL[period as typeof PERIODS[number]],
      candles,
      source: snapshot.source,
      websocketUrl: config.websocketUrl,
      observedAt: new Date().toISOString(),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ message: safePacificaMessage(error) }, { status: 503 });
  }
}
