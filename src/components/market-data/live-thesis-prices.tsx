"use client";

import { useEffect, useMemo, useState } from "react";
import type { Thesis } from "@/lib/types";

type Market = {
  symbol: string;
  active: boolean;
};

type Quote = {
  symbol: string;
  markPrice: string;
  observedAt: string;
  fresh: boolean;
};

type MarketResponse = {
  mode: "demo" | "live-testnet" | "error";
  markets?: Market[];
  quotes?: Quote[];
  message?: string;
};

function formatPrice(value: string | undefined) {
  if (value === undefined || !Number.isFinite(Number(value))) return null;

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  }).format(Number(value));
}

export function useLiveThesisPrices(theses: Thesis[]) {
  const symbols = useMemo(
    () => [...new Set(theses.flatMap((thesis) =>
      thesis.assets.map((asset) => asset.symbol)
    ))].sort(),
    [theses]
  );

  const symbolKey = symbols.join(",");
  const [response, setResponse] = useState<MarketResponse>({
    mode: "demo",
  });

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const requestedSymbols: string[] = symbolKey ? symbolKey.split(",") : [];

    async function refresh() {
      try {
        const params = new URLSearchParams();
        requestedSymbols.forEach((symbol) => params.append("symbol", symbol));

        const result = await fetch(
          `/api/pacifica/markets?${params.toString()}`,
          { cache: "no-store", signal: controller.signal }
        );

        const data = await result.json() as MarketResponse;

        if (!result.ok) {
          throw new Error(data.message ?? "Live market data unavailable.");
        }

        if (!cancelled) setResponse(data);
      } catch (error) {
        if (cancelled || (error instanceof Error && error.name === "AbortError")) {
          return;
        }

        setResponse({
          mode: "error",
          message: error instanceof Error
            ? error.message
            : "Live market data unavailable.",
        });
      }
    }

    void refresh();
    const timer = setInterval(() => void refresh(), 10_000);

    return () => {
      cancelled = true;
      controller.abort();
      if (timer) clearInterval(timer);
    };
  }, [symbolKey]); // The symbol list is represented by its stable key.

  const prices = useMemo(() => {
    const marketMap = new Map(
      (response.markets ?? []).map((market) => [market.symbol, market])
    );
    const quoteMap = new Map(
      (response.quotes ?? []).map((quote) => [quote.symbol, quote])
    );

    return {
      get(symbol: string) {
        const market = marketMap.get(symbol);
        const quote = quoteMap.get(symbol);

        if (
          response.mode !== "live-testnet" ||
          !market?.active ||
          !quote ||
          !Number.isFinite(Number(quote.markPrice)) ||
          Number(quote.markPrice) <= 0
        ) {
          return {
            price: null,
            status: response.mode === "error"
              ? "Market data unavailable"
              : "Unavailable on testnet",
            fresh: false,
          };
        }

        return {
          price: formatPrice(quote.markPrice),
          status: quote.fresh ? "Live · Pacifica testnet" : "Price stale",
          fresh: quote.fresh,
          observedAt: quote.observedAt,
        };
      },
    };
  }, [response]);

  return { prices, response };
}

export function LivePrice({
  symbol,
  prices,
}: {
  symbol: string;
  prices: ReturnType<typeof useLiveThesisPrices>["prices"];
}) {
  const quote = prices.get(symbol);

  return (
    <span className="live-market-price" title={quote.observedAt
      ? `Quote timestamp: ${quote.observedAt}`
      : quote.status}>
      <strong>{quote.price ?? "—"}</strong>
      <small className={quote.fresh ? "price-fresh" : "price-unavailable"}>
        {quote.status}
      </small>
    </span>
  );
}
