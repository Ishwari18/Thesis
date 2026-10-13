"use client";

import { useState } from "react";
import { MarketIdentity } from "./market-identity";

export type PortfolioLegView = {
  id: string;
  symbol: string;
  direction: "long" | "short";
  targetWeight: string;
  filledQuantity: string;
  closedQuantity: string;
  remainingQuantity: string;
  entryPrice: string | null;
  markPrice: string | null;
  pnl: string | null;
  executionStatuses: string[];
};

export type PortfolioAllocationView = {
  id: string;
  thesisName: string;
  slug: string;
  side: "long" | "short";
  collateral: string;
  leverage: number;
  exposure: string;
  status: string;
  createdAt: string;
  closedAt: string | null;
  pnl: string | null;
  pnlPercent: string | null;
  badges: string[];
  legs: PortfolioLegView[];
};

type ApiResult = {
  status?: string;
  error?: string;
  reconciliationRequired?: boolean;
  needsReconciliation?: boolean;
  unresolvedClientOrderIds?: string[];
  results?: Array<{ symbol: string; status: string; fillPrice?: string | null; fillQuantity?: string | null }>;
  orders?: Array<{ symbol: string; status: string; quantity?: string; side?: string; fillPrice?: string | null }>;
};

function usd(value: string | null) {
  if (value === null || !Number.isFinite(Number(value))) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(Number(value));
}

export function PortfolioAllocationCard({ initial }: { initial: PortfolioAllocationView }) {
  const [card, setCard] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [needsReconcile, setNeedsReconcile] = useState(initial.badges.includes("Needs reconciliation") || initial.badges.includes("Fills unconfirmed"));
  const [closeReview, setCloseReview] = useState(false);
  const [closeResults, setCloseResults] = useState<ApiResult["orders"]>([]);
  const isOpen = card.status === "open";
  const closeOrders = card.legs.filter((leg) => Number(leg.remainingQuantity) > 0).map((leg) => ({
    symbol: leg.symbol,
    quantity: leg.remainingQuantity,
    side: leg.direction === "long" ? "sell" : "buy",
  }));

  async function reconcile() {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/trade/reconcile", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ allocationId: card.id }) });
      const result = await response.json() as ApiResult;
      if (response.status === 401) throw new Error("Sign in to reconcile this thesis.");
      if (!response.ok) throw new Error(result.error ?? "This thesis could not be reconciled.");
      setNeedsReconcile(Boolean(result.needsReconciliation));
      if (!result.needsReconciliation && !result.unresolvedClientOrderIds?.length) {
        window.location.reload();
        return;
      }
      setMessage("Some fills are still unclear. Do not retry these orders; check again later.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "This thesis could not be reconciled.");
    } finally { setBusy(false); }
  }

  async function close() {
    if (busy || !closeOrders.length) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/trade/close", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ allocationId: card.id, idempotencyKey: crypto.randomUUID() }) });
      const result = await response.json() as ApiResult;
      if (response.status === 401) throw new Error("Sign in to close this thesis.");
      if (response.status === 403) throw new Error("This THESIS account is not authorized to use the configured Pacifica testnet wallet.");
      if (!response.ok && response.status !== 202) throw new Error(result.error ?? "This thesis could not be closed.");
      setCloseReview(false);
      setCloseResults(result.orders ?? []);
      setNeedsReconcile(Boolean(result.reconciliationRequired || result.unresolvedClientOrderIds?.length));
      setMessage(result.status === "submission_unknown" ? "Close outcome unclear. Do not retry; reconcile this thesis." : "Close orders submitted. Reconcile to confirm exit fills and realized P&L.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "This thesis could not be closed.");
    } finally { setBusy(false); }
  }

  return <article className="portfolio-card" key={initial.id}>
    <div className="portfolio-card-head"><div><div className="eyebrow">{card.status === "closed" ? "THESIS HISTORY" : "THESIS ALLOCATION"}</div><h2>{card.thesisName}</h2></div><span className="portfolio-status">{card.status}</span></div>
    <div className="portfolio-status-row"><span className="portfolio-status">{card.side.toUpperCase()}</span>{card.badges.map((badge) => <span className="portfolio-status" key={badge}>{badge}</span>)}</div>
    <div className="portfolio-metrics"><span>Collateral <strong>{usd(card.collateral)}</strong></span><span>Leverage <strong>{card.leverage}x</strong></span><span>Exposure <strong>{usd(card.exposure)}</strong></span><span>{card.status === "closed" ? "Realized P&L" : "Thesis P&L"} <strong>{usd(card.pnl)}{card.pnlPercent !== null ? ` (${Number(card.pnlPercent).toFixed(2)}%)` : ""}</strong></span></div>
    <div className="portfolio-legs">{card.legs.length ? card.legs.map((leg) => <div className="portfolio-leg" key={leg.id}>
      <span><MarketIdentity symbol={leg.symbol} variant="compact" /> <small>{leg.direction.toUpperCase()} · {(Number(leg.targetWeight) * 100).toFixed(1)}%</small></span>
      <span>Qty {leg.filledQuantity || "—"}{Number(leg.closedQuantity) > 0 ? ` · closed ${leg.closedQuantity}` : ""}</span>
      <span>Entry {usd(leg.entryPrice)}</span>
      <span>Mark {usd(leg.markPrice)}</span>
      <span>P&amp;L {usd(leg.pnl)}</span>
      {leg.executionStatuses.length > 0 && <span>{leg.executionStatuses.join(", ")}</span>}
    </div>) : <p className="portfolio-note">No allocation legs were returned.</p>}</div>
    {message && <p className="inline-info" role={needsReconcile ? "alert" : "status"}>{message}</p>}
    {!!closeResults?.length && <div className="portfolio-legs" aria-label="Close order results">
      {closeResults.map((order, index) => <div className="portfolio-leg" key={`${order.symbol}-${index}`}>
        <span><MarketIdentity symbol={order.symbol} variant="compact" /></span><span>{order.side?.toUpperCase() ?? "CLOSE"}</span><span>{order.quantity ?? "—"} units</span><span>{order.status === "filled" && order.fillPrice ? `Filled at ${usd(order.fillPrice)}` : order.status.replaceAll("_", " ")}</span>
      </div>)}
    </div>}
    {isOpen && <div className="portfolio-actions">
      {needsReconcile && <button type="button" className="portfolio-discover" disabled={busy} onClick={reconcile}>{busy ? "Reconciling…" : "Reconcile"}</button>}
      <button type="button" className="primary-trade" disabled={busy || needsReconcile || !closeOrders.length} onClick={() => setCloseReview(true)}>Close thesis</button>
    </div>}
    {closeReview && <div className="trade-confirm" role="dialog" aria-modal="true" aria-labelledby={`close-title-${card.id}`}>
      <div className="eyebrow">REDUCE ONLY · PACIFICA TESTNET</div><h3 id={`close-title-${card.id}`}>Review exact close orders</h3>
      <p>These orders close only the remaining quantities recorded for this thesis.</p>
      <div className="portfolio-legs">{closeOrders.map((order) => <div className="portfolio-leg" key={order.symbol}><span><MarketIdentity symbol={order.symbol} variant="compact" /></span><span>{order.side.toUpperCase()}</span><span>{order.quantity} units</span><span>Reduce only</span></div>)}</div>
      <div className="portfolio-actions"><button type="button" className="primary-trade" disabled={busy} onClick={close}>{busy ? "Submitting…" : "Confirm close"}</button><button type="button" className="portfolio-discover" disabled={busy} onClick={() => setCloseReview(false)}>Cancel</button></div>
    </div>}
    <p className="portfolio-note">Exchange net positions are shared across theses. This card displays only the quantities and P&amp;L recorded for this allocation.</p>
  </article>;
}
