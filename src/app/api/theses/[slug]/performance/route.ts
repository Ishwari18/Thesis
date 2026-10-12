import { NextResponse } from "next/server";
import { adminClient } from "@/lib/auth/server";
import { PERIOD_INTERVAL, PERIODS, periodStart, type ChartPeriod } from "@/lib/market-chart";
import { buildWeightedThesisIndex, calculateWeightedThesisReturn, type ThesisIndexConstituent } from "@/lib/thesis-index";
import { getPacificaMarkCandles } from "@/server/providers/pacifica/candles";
import { readPacificaConfig } from "@/server/providers/pacifica/config";
import { safePacificaMessage } from "@/server/providers/pacifica/errors";
import { fetchPacificaSnapshot } from "@/server/providers/pacifica/market-data";

export const dynamic = "force-dynamic";

type RequestContext = { params: Promise<{ slug: string }> };
type MarketRow = { id: string; symbol: string };
type AssetRow = { market_id: string; target_weight: string; direction: "long" | "short" };

function periodFrom(request: Request): ChartPeriod {
  const value = new URL(request.url).searchParams.get("period");
  return PERIODS.includes(value as ChartPeriod) ? value as ChartPeriod : "1D";
}

export async function GET(request: Request, context: RequestContext) {
  const { slug } = await context.params;
  const period = periodFrom(request);
  const db = adminClient();
  const { data: thesisData, error: thesisError } = await db.from("theses").select("id,name").eq("slug", slug).eq("status", "published").maybeSingle();
  if (thesisError) return NextResponse.json({ status: "unavailable", message: "Thesis composition could not be loaded." }, { status: 503 });
  if (!thesisData) return NextResponse.json({ status: "not-found" }, { status: 404 });

  const { data: assetData, error: assetError } = await db.from("thesis_assets").select("market_id,target_weight,direction").eq("thesis_id", thesisData.id);
  if (assetError) return NextResponse.json({ status: "unavailable", message: "Thesis constituent weights could not be loaded." }, { status: 503 });
  const assets = (assetData ?? []) as AssetRow[];
  if (!assets.length) return NextResponse.json({ status: "unavailable", message: "This thesis has no published constituent allocation." }, { status: 503 });

  const { data: marketData, error: marketError } = await db.from("markets").select("id,symbol").in("id", assets.map((asset) => asset.market_id));
  if (marketError) return NextResponse.json({ status: "unavailable", message: "Thesis market symbols could not be loaded." }, { status: 503 });
  const symbolsById = new Map(((marketData ?? []) as MarketRow[]).map((market) => [market.id, market.symbol]));
  const basket: ThesisIndexConstituent[] = assets.map((asset) => ({
    symbol: symbolsById.get(asset.market_id) ?? "",
    weight: asset.target_weight,
    direction: asset.direction,
  }));
  if (basket.some((asset) => !asset.symbol)) return NextResponse.json({ status: "unavailable", message: "A thesis constituent is missing its market mapping." }, { status: 503 });

  try {
    const config = readPacificaConfig();
    if (!config.marketDataEnabled) throw new Error("Pacifica testnet market data is disabled.");
    const marketSnapshot = await fetchPacificaSnapshot();
    const available = new Set(marketSnapshot.markets.filter((market) => market.active).map((market) => market.symbol));
    const unavailableSymbols = basket.filter((asset) => !available.has(asset.symbol)).map((asset) => asset.symbol);
    if (unavailableSymbols.length) {
      return NextResponse.json({ status: "unavailable", message: `Pacifica has no active market for: ${unavailableSymbols.join(", ")}.` }, { status: 503 });
    }
    const now = Date.now();
    const startTime = periodStart(period, now);
    const candleResults = await Promise.all(basket.map(async (asset) => [asset.symbol, await getPacificaMarkCandles({
      symbol: asset.symbol,
      interval: PERIOD_INTERVAL[period],
      startTime,
    })] as const));
    const index = buildWeightedThesisIndex(new Map(candleResults), basket);
    const freshQuotes = new Map(marketSnapshot.quotes.filter((quote) => quote.fresh).map((quote) => [quote.symbol, { price: quote.markPrice, timestamp: Date.parse(quote.observedAt) }]));
    const current = calculateWeightedThesisReturn(basket, index.basePrices, freshQuotes, now);
    const quoteTimes = basket.map((asset) => freshQuotes.get(asset.symbol)?.timestamp).filter((value): value is number => value !== undefined);
    const completeQuotes = quoteTimes.length === basket.length;

    return NextResponse.json({
      thesis: thesisData.name,
      period,
      metric: "target-weighted-unleveraged-return-percent",
      methodology: "For each selected period, calculate each constituent's price return from the first timestamp shared by all constituents, multiply by its published target weight and long/short direction, then sum the weighted returns. Excludes user executions, leverage, fees, funding, and rebalancing.",
      points: index.points,
      historicalAvailable: index.points.length >= 2,
      historyMessage: index.points.length >= 2 ? null : index.missingSymbols.length
        ? `Historical data unavailable for: ${index.missingSymbols.join(", ")}.`
        : "Historical data unavailable: Pacifica has not returned enough aligned candles for every constituent.",
      status: completeQuotes ? "live" : "partial",
      currentReturn: current.value,
      missingPriceSymbols: current.missingSymbols,
      basket,
      basePrices: index.basePrices,
      currentPrices: Object.fromEntries(freshQuotes),
      websocketUrl: config.websocketUrl,
      observedAt: quoteTimes.length ? new Date(Math.max(...quoteTimes)).toISOString() : marketSnapshot.observedAt,
      source: marketSnapshot.source,
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ status: "unavailable", message: safePacificaMessage(error) }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
}
