"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, Info, ShieldAlert } from "lucide-react";
import type { Thesis } from "@/lib/types";
import type { LiveAllocationContext } from "@/server/services/allocation";
import { minimumCollateral, previewAllocation } from "@/server/services/allocation";

type MarketResponse = {
  mode: "loading" | "live-testnet" | "error";
  source?: "pacifica-testnet";
  markets?: LiveAllocationContext["markets"];
  quotes?: LiveAllocationContext["quotes"];
  message?: string;
};
type TradeResult = {
  allocationId?: string;
  status?: string;
  error?: string;
  providerCode?: number;
  providerMessage?: string;
  providerHttpStatus?: number;
  results?: Array<{ symbol: string; side?: string; quantity?: string; status: string; fillPrice?: string | null; fillQuantity?: string | null }>;
  unresolvedClientOrderIds?: string[];
  leverageVerification?: { impliedLeverage: string | null; expectedLeverage: number; verified: boolean | null };
};

const opposite = (direction: "long" | "short") => direction === "long" ? "short" : "long";

export function TradePanel({ thesis }: { thesis: Thesis }) {
  const [amount, setAmount] = useState("100");
  const [leverage, setLeverage] = useState(3);
  const [side, setSide] = useState<"long" | "short">("long");
  const [expanded, setExpanded] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [loading, setLoading] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [result, setResult] = useState<TradeResult | null>(null);
  const [actionMessage, setActionMessage] = useState("");
  const [marketResponse, setMarketResponse] = useState<MarketResponse>({ mode: "loading" });
  const symbols = useMemo(() => thesis.assets.map((asset) => asset.symbol), [thesis.assets]);

  useEffect(() => {
    const params = new URLSearchParams();
    symbols.forEach((symbol) => params.append("symbol", symbol));
    let cancelled = false;
    fetch(`/api/pacifica/markets?${params.toString()}`, { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json() as MarketResponse;
        if (!cancelled) setMarketResponse(response.ok ? data : { mode: "error", message: data.message ?? "Pacifica market data is unavailable." });
      })
      .catch(() => { if (!cancelled) setMarketResponse({ mode: "error", message: "Pacifica market data is unavailable." }); });
    return () => { cancelled = true; };
  }, [symbols]);

  const live = marketResponse.mode === "live-testnet" && marketResponse.markets && marketResponse.quotes
    ? { source: "pacifica-testnet" as const, markets: marketResponse.markets, quotes: marketResponse.quotes }
    : undefined;
  const marketDataReady = Boolean(live && symbols.every((symbol) =>
    live!.markets.some((market) => market.symbol === symbol) && live!.quotes.some((quote) => quote.symbol === symbol && quote.fresh),
  ));
  const cap = marketDataReady ? Math.min(...symbols.map((symbol) => live!.markets.find((market) => market.symbol === symbol)!.maxLeverage)) : 0;
  const selectedThesis = {
    assets: thesis.assets.map((asset) => ({ ...asset, direction: side === "short" ? opposite(asset.direction) : asset.direction })),
  };
  const preview = previewAllocation(selectedThesis, amount, leverage, live);
  const minimum = marketDataReady
    ? thesis.assets.reduce((max, asset) => {
      const market = live!.markets.find((row) => row.symbol === asset.symbol)!;
      return Math.max(max, Number(minimumCollateral(market.minNotional, leverage, asset.weight)));
    }, 0)
    : null;
  const leverageBlocked = cap > 0 && leverage > cap;
  const disabled = !marketDataReady || !preview.valid || leverageBlocked || loading;

  async function openPosition() {
    if (disabled || loading) return;
    setLoading(true);
    setActionMessage("");
    setResult(null);
    try {
      const response = await fetch("/api/trade/open", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ thesisSlug: thesis.slug, collateral: amount, leverage, side, idempotencyKey: crypto.randomUUID() }),
      });
      const body = await response.json().catch(() => null) as TradeResult | null;
      if (!body) throw new Error(`THESIS returned an unreadable response (HTTP ${response.status}). Check the dev server terminal for details.`);
      if (response.status === 401) throw new Error("Sign in to THESIS before opening a position.");
      if (response.status === 403) throw new Error("This THESIS account is not authorized to use the configured Pacifica testnet wallet.");
      if (!response.ok && response.status !== 202) throw new Error(body.error ?? "The thesis position could not be opened.");
      setResult(body);
      setReviewing(false);
      if (body.status === "submission_unknown") setActionMessage(body.error ?? "Order outcome unclear. Do not retry; open Portfolio and reconcile this thesis.");
      else if (body.results?.some((row) => row.status === "accepted_unconfirmed")) setActionMessage("Pacifica accepted the order, but fills are not confirmed yet. Reconcile in Portfolio before closing.");
      else if (body.status === "partial") setActionMessage("Some legs were rejected. Confirmed legs remain open; review each leg and use Portfolio to reconcile.");
      else setActionMessage(body.error ?? "Thesis orders submitted.");
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "The thesis position could not be opened.");
    } finally {
      setLoading(false);
    }
  }

  return <aside className="trade-panel">
    <div className="panel-head"><div><div className="eyebrow">PACIFICA TESTNET</div><h2>Open thesis position</h2></div><span className="demo-tag">TESTNET</span></div>
    <div className="field-label">Collateral <span>USD</span></div>
    <div className="amount-input"><span>$</span><input inputMode="decimal" value={amount} onChange={(event) => { setAmount(event.target.value); setReviewing(false); setResult(null); setActionMessage(""); }} aria-label="Collateral amount" /></div>
    <div className="field-label leverage-label">Leverage <button className="info-button" onClick={() => setShowInfo(!showInfo)} aria-label="About leverage"><Info size={13} /></button></div>
    <div className="leverage-options">{[2, 3, 5].map((value) => <button className={leverage === value ? "selected" : ""} key={value} disabled={!marketDataReady || value > cap || loading} onClick={() => { setLeverage(value); setReviewing(false); setResult(null); setActionMessage(""); }}>{value}x</button>)}</div>
    {showInfo && <div className="inline-info">The highest leverage is capped by the least leveraged market in this thesis. Orders are sent to Pacifica testnet.</div>}
    <div className="field-label">Side</div>
    <div className="leverage-options"><button className={side === "long" ? "selected" : ""} disabled={loading} onClick={() => { setSide("long"); setReviewing(false); setResult(null); }}>Go long</button><button className={side === "short" ? "selected" : ""} disabled={loading} onClick={() => { setSide("short"); setReviewing(false); setResult(null); }}>Go short</button></div>
    <div className="exposure-line"><span>Approx. exposure</span><strong>${preview.exposure ?? "0.00"}</strong></div>
    <div className="minimum-note"><Info size={13} /><span>{minimum === null ? "Minimum collateral requires fresh Pacifica market data." : `Minimum collateral at ${leverage}x: $${minimum.toFixed(2)}`}</span></div>
    <button className="allocation-toggle" onClick={() => setExpanded(!expanded)}><span>Allocation preview <small>{thesis.assets.length} assets</small></span><ChevronDown size={15} className={expanded ? "rotated" : ""} /></button>
    {expanded && <div className="allocation-legs">{preview.legs.map((leg) => <div className="allocation-leg" key={leg.symbol}><span className="leg-symbol">{leg.symbol}</span><span className="leg-weight">{(Number(leg.weight) * 100).toFixed(0)}%</span><strong>${leg.notional ?? leg.targetNotional}</strong>{leg.quantity && <small className="leg-quantity">{leg.quantity} units</small>}{!leg.eligible && <small className="leg-warning">Min ${leg.minimum}</small>}</div>)}</div>}
    {marketResponse.mode === "loading" && <div className="inline-info" role="status">Loading fresh Pacifica markets and prices…</div>}
    {marketResponse.mode === "error" && <div className="warning-box" role="alert"><ShieldAlert size={14} /><span>{marketResponse.message} Trading is disabled until live data is available.</span></div>}
    {marketDataReady && preview.error && <div className="warning-box"><ShieldAlert size={14} /><span>{preview.error}</span></div>}
    {marketDataReady && leverageBlocked && <div className="warning-box"><ShieldAlert size={14} /><span>This thesis supports at most {cap}x based on current Pacifica market limits.</span></div>}

    {!reviewing && !result && <button className="primary-trade" disabled={disabled} onClick={() => setReviewing(true)}>{`Review ${side === "long" ? "long" : "short"}`}</button>}
    {reviewing && <div className="inline-info" role="group" aria-label="Confirm thesis order"><strong>Review {side} position</strong><p>${amount} collateral at {leverage}x, approximately ${preview.exposure} exposure. This sends one market batch covering {thesis.assets.length} legs.</p><button className="primary-trade" disabled={disabled} onClick={openPosition}>{loading ? "Submitting…" : `Confirm and go ${side}`}</button><button className="portfolio-discover" disabled={loading} onClick={() => setReviewing(false)}>Back</button></div>}
    {actionMessage && <div className="inline-info" role={result?.status === "submission_unknown" ? "alert" : "status"}>{actionMessage}{actionMessage.includes("Sign in") && <> <Link href="/auth">Sign in</Link></>}{result?.providerCode !== undefined && <div>Pacifica error code: {result.providerCode}{result.providerHttpStatus ? ` (HTTP ${result.providerHttpStatus})` : ""}{result.providerMessage ? ` — ${result.providerMessage}` : ""}</div>}</div>}
    {result?.results?.length ? <div className="portfolio-legs" aria-label="Per-leg trade results">{result.results.map((row) => <div className="portfolio-leg" key={row.symbol}><span><strong>{row.symbol}</strong></span><span>{row.status.replaceAll("_", " ")}</span><span>{row.fillQuantity ? `${row.fillQuantity} filled` : row.quantity ?? "—"}</span><span>{row.fillPrice ? `Fill $${row.fillPrice}` : row.status === "accepted_unconfirmed" ? "Fill unconfirmed" : "—"}</span></div>)}</div> : null}
    {result?.allocationId && <Link className="portfolio-discover" href="/portfolio">View Portfolio</Link>}
    {result?.leverageVerification?.verified === false && <div className="warning-box" role="alert">Observed implied leverage was {result.leverageVerification.impliedLeverage}x; expected {result.leverageVerification.expectedLeverage}x. Review the exchange account before opening another trade.</div>}
    <p className="trade-disclaimer">Orders execute on the configured single Pacifica testnet account. Closing is available from Portfolio after fills are confirmed.</p>
  </aside>;
}
