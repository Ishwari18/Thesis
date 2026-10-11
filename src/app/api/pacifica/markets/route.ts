import { NextResponse } from "next/server";
import { listTheses } from "@/server/services/theses/service";
import { readPacificaConfig } from "@/server/providers/pacifica/config";
import { fetchPacificaSnapshot } from "@/server/providers/pacifica/market-data";
import { safePacificaMessage } from "@/server/providers/pacifica/errors";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const config = readPacificaConfig();
if (!config.marketDataEnabled) {
  return NextResponse.json(
    {
      mode: "error",
      message: "Pacifica testnet market data is disabled. Enable it to load live data.",
    },
    { status: 503 },
  );
}
 

  try {
    //
    const params = new URL(request.url).searchParams;
const requested = params.getAll("symbol");

const theses = requested.length ? [] : await listTheses();

const symbols = requested.length
  ? new Set(requested.filter((symbol) => /^[A-Z0-9]+$/.test(symbol)))
  : new Set(
      theses.flatMap((thesis) =>
        thesis.assets.map((asset) => asset.symbol),
      ),
    );

if (symbols.size > 100) {
  return NextResponse.json(
    { mode: "error", message: "Too many market symbols requested." },
    { status: 400 },
  );
}
    
 //
    const snapshot = await fetchPacificaSnapshot();

    const markets = snapshot.markets.filter((market) =>
      symbols.has(market.symbol),
    );
    const quotes = snapshot.quotes.filter((quote) =>
      symbols.has(quote.symbol),
    );

    const returnedMarkets = new Set(markets.map((market) => market.symbol));
    const returnedQuotes = new Set(quotes.map((quote) => quote.symbol));

    const missingSymbols = [...symbols].filter(
      (symbol) =>
        !returnedMarkets.has(symbol) || !returnedQuotes.has(symbol),
    );

    return NextResponse.json(
      {
        mode: "live-testnet",
        source: snapshot.source,
        observedAt: snapshot.observedAt,
        markets,
        quotes,
        missingSymbols,
      },
      {
        headers: {
          "Cache-Control": "private, max-age=5, stale-while-revalidate=10",
        },
      },
    );
  } catch (error) {
    return NextResponse.json(
      { mode: "error", message: safePacificaMessage(error) },
      { status: 503 },
    );
  }
}
