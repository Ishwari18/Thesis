"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronDown, Info, ShieldAlert } from "lucide-react";
import { usePrivy } from "@privy-io/react-auth";
import type { Thesis } from "@/lib/types";
import type { LiveAllocationContext } from "@/server/services/allocation";
import { minimumCollateral, previewAllocation } from "@/server/services/allocation";
import { safeAuthRedirectPath } from "@/lib/supabase/redirect";
import { abbreviatedAddress } from "@/lib/auth/profile";
import { canSubmitTrade } from "@/lib/trading/readiness";
import { connectAndLinkPhantom, signPacificaActionWithPhantom, signThesisTradeApprovalWithPhantom } from "@/lib/auth/phantom-connection";
import { ensureThesisSession } from "@/lib/auth/session";
import type { ThesisTradeApproval } from "@/lib/trading/trade-approval";

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
type PacificaAccountResponse = { source?: "pacifica-testnet"; account?: { address?: string; availableBalance?: string }; leverageSettings?: Record<string, number>; error?: string };
type AgentResponse = { bound?: boolean; agentAddress?: string; error?: string };

const opposite = (direction: "long" | "short") => direction === "long" ? "short" : "long";

export function TradePanel({ thesis }: { thesis: Thesis }) {
  const router = useRouter();
  const pathname = usePathname();
  const { ready: authReady, authenticated, getAccessToken } = usePrivy();
  const [appSession, setAppSession] = useState<boolean | null>(null);
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
  const [accountState, setAccountState] = useState<{ mode: "idle" | "loading" | "ready" | "error"; account?: PacificaAccountResponse["account"]; leverageSettings?: Record<string, number>; message?: string }>({ mode: "idle" });
  const [walletMessage, setWalletMessage] = useState("");
  const [walletConnecting, setWalletConnecting] = useState(false);
  const [phantomAddress, setPhantomAddress] = useState<string | null>(null);
  const [agentState, setAgentState] = useState<{ mode: "idle" | "loading" | "ready" | "unbound" | "error"; agentAddress?: string; message?: string }>({ mode: "idle" });
  const [agentConnecting, setAgentConnecting] = useState(false);
  const isAuthenticated = authenticated || appSession === true;
  const isAuthReady = authReady && (authenticated || appSession !== null);
  const connectedPhantom = phantomAddress ? { address: phantomAddress } : null;
  const walletMatchesAccount = Boolean(phantomAddress);
  // This integration sends requests only to Pacifica's configured testnet API.
  const testnetVerified = accountState.mode === "ready" && agentState.mode === "ready";
  const symbols = useMemo(() => thesis.assets.map((asset) => asset.symbol), [thesis.assets]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/privy-session", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json() as { authenticated?: boolean };
        if (!cancelled) setAppSession(response.ok && data.authenticated === true);
      })
      .catch(() => { if (!cancelled) setAppSession(false); });
    return () => { cancelled = true; };
  }, [authReady, authenticated]);

  useEffect(() => {
    const params = new URLSearchParams();
    symbols.forEach((symbol) => params.append("symbol", symbol));
    let cancelled = false;
    let refreshing = false;
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        const response = await fetch(`/api/pacifica/markets?${params.toString()}`, { cache: "no-store" });
        const data = await response.json() as MarketResponse;
        if (!cancelled) setMarketResponse(response.ok ? data : { mode: "error", message: data.message ?? "Pacifica market data is unavailable." });
      } catch {
        if (!cancelled) setMarketResponse({ mode: "error", message: "Pacifica market data is unavailable." });
      } finally {
        refreshing = false;
      }
    };
    void refresh();
    // Quotes can expire while a user is linking Phantom, enabling the agent,
    // or reviewing the trade. Keep the preview on a current Pacifica snapshot.
    const interval = window.setInterval(() => { void refresh(); }, 5_000);
    return () => { cancelled = true; window.clearInterval(interval); };
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

  useEffect(() => {
    if (!isAuthReady || !isAuthenticated || !walletMatchesAccount) {
      setAccountState({ mode: "idle" });
      return;
    }
    let cancelled = false;
    setAccountState({ mode: "loading" });
    fetch("/api/pacifica/account", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json() as PacificaAccountResponse;
        if (cancelled) return;
        if (!response.ok) return setAccountState({ mode: "error", message: data.error ?? "Could not verify the authorized Pacifica testnet account." });
        if (data.account?.address !== connectedPhantom?.address) return setAccountState({ mode: "error", message: "The connected Phantom address does not match this linked Pacifica testnet account." });
        if (data.account?.availableBalance == null || !Number.isFinite(Number(data.account.availableBalance)) || Number(data.account.availableBalance) < 0) return setAccountState({ mode: "error", message: "Pacifica returned no usable available-collateral balance. Trading remains disabled." });
        setAccountState({ mode: "ready", account: data.account, leverageSettings: data.leverageSettings });
      })
      .catch(() => { if (!cancelled) setAccountState({ mode: "error", message: "Pacifica testnet account status could not be loaded." }); });
    return () => { cancelled = true; };
  }, [isAuthReady, isAuthenticated, walletMatchesAccount, connectedPhantom?.address]);

  useEffect(() => {
    if (!isAuthReady || !isAuthenticated || !phantomAddress) {
      setAgentState({ mode: "idle" });
      return;
    }
    let cancelled = false;
    setAgentState({ mode: "loading" });
    fetch("/api/pacifica/agent", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json() as AgentResponse;
        if (cancelled) return;
        if (!response.ok) return setAgentState({ mode: "error", message: data.error ?? "Trade-agent setup could not be checked." });
        setAgentState({ mode: data.bound ? "ready" : "unbound", agentAddress: data.agentAddress });
      })
      .catch(() => { if (!cancelled) setAgentState({ mode: "error", message: "Trade-agent setup could not be checked." }); });
    return () => { cancelled = true; };
  }, [isAuthReady, isAuthenticated, phantomAddress]);

  const availableCollateral = Number(accountState.account?.availableBalance);
  const hasFunding = accountState.mode === "ready" && Number.isFinite(availableCollateral) && Number(amount) <= availableCollateral;
  const readinessReady = canSubmitTrade({
    authenticated: isAuthReady && isAuthenticated,
    phantomConnected: Boolean(connectedPhantom),
    walletOwnershipVerified: Boolean(phantomAddress),
    testnetVerified,
    accountAddressMatches: accountState.mode === "ready" && accountState.account?.address === connectedPhantom?.address,
    availableCollateral: accountState.mode === "ready" && Number.isFinite(availableCollateral) ? availableCollateral : null,
    requestedCollateral: Number(amount),
    freshMarketData: marketDataReady,
    allocationValid: preview.valid,
    leverageAllowed: !leverageBlocked,
    submitting: loading,
  });
  const logInHref = `/auth?next=${encodeURIComponent(safeAuthRedirectPath(`${pathname}?trade=1`))}`;

  useEffect(() => {
    if (!isAuthReady || !isAuthenticated) { setPhantomAddress(null); return; }
    let cancelled = false;
    fetch("/api/auth/phantom", { cache: "no-store" }).then(async (response) => {
      const data = await response.json() as { address?: string | null };
      if (!cancelled && response.ok) setPhantomAddress(data.address ?? null);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [isAuthReady, isAuthenticated]);

  async function connectPhantom() {
    setWalletMessage("");
    setWalletConnecting(true);
    try {
      await ensureThesisSession(await getAccessToken());
      setAppSession(true);
      setPhantomAddress(await connectAndLinkPhantom());
      router.refresh();
    }
    catch (error) { setWalletMessage(error instanceof Error ? error.message : "Phantom connection failed."); }
    finally { setWalletConnecting(false); }
  }

  async function enableTradeAgent() {
    if (!phantomAddress || !agentState.agentAddress || agentConnecting) return;
    setAgentConnecting(true);
    setWalletMessage("");
    try {
      const action = await signPacificaActionWithPhantom("bind_agent_wallet", { agent_wallet: agentState.agentAddress }, phantomAddress);
      const response = await fetch("/api/pacifica/agent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(action) });
      const data = await response.json() as AgentResponse;
      if (!response.ok || data.bound !== true) throw new Error(data.error ?? "Pacifica did not confirm the trade-agent setup.");
      setAgentState({ mode: "ready", agentAddress: data.agentAddress });
      setWalletMessage("One-confirmation trading is enabled. You can revoke the trade-only agent from Pacifica.");
    } catch (error) {
      setWalletMessage(error instanceof Error ? error.message : "Trade-agent setup failed.");
    } finally {
      setAgentConnecting(false);
    }
  }

  async function openPosition() {
    if (disabled || loading || !readinessReady) return;
    setLoading(true);
    setActionMessage("");
    setResult(null);
    try {
      if (!phantomAddress) throw new Error("Connect Phantom before confirming the trade.");
      const idempotencyKey = crypto.randomUUID();
      const approval: ThesisTradeApproval = {
        account: phantomAddress,
        thesisSlug: thesis.slug,
        collateral: amount,
        leverage,
        side,
        idempotencyKey,
        timestamp: Date.now(),
        legs: preview.legs.map((leg) => ({ symbol: leg.symbol, amount: String(leg.quantity), side: leg.direction === "long" ? "bid" : "ask", slippage_percent: "1", reduce_only: false })),
      };
      setActionMessage("Approve this complete thesis trade once in Phantom.");
      const signature = await signThesisTradeApprovalWithPhantom(approval, phantomAddress);
      setActionMessage("Submitting your Phantom-authorized orders to Pacifica testnet…");
      const response = await fetch("/api/trade/open", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ thesisSlug: thesis.slug, collateral: amount, leverage, side, idempotencyKey, tradeApproval: { approval, signature } }),
      });
      const body = await response.json().catch(() => null) as TradeResult | null;
      if (!body) throw new Error(`THESIS returned an unreadable response (HTTP ${response.status}). Check the dev server terminal for details.`);
      if (response.status === 401) throw new Error("Sign in to THESIS before opening a position.");
      if (response.status === 403) throw new Error(body.error ?? "Connect your Phantom wallet before trading.");
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
    {isAuthReady && isAuthenticated && <>
    <div className="field-label">Collateral <span>USD</span></div>
    <div className="amount-input"><span>$</span><input inputMode="decimal" value={amount} onChange={(event) => { setAmount(event.target.value); setReviewing(false); setResult(null); setActionMessage(""); }} aria-label="Collateral amount" /></div>
    <div className="field-label leverage-label">Leverage <button className="info-button" onClick={() => setShowInfo(!showInfo)} aria-label="About leverage"><Info size={13} /></button></div>
    <div className="leverage-options">{[2, 3, 5].map((value) => <button className={leverage === value ? "selected" : ""} key={value} disabled={!marketDataReady || value > cap || loading} onClick={() => { setLeverage(value); setReviewing(false); setResult(null); setActionMessage(""); }}>{value}x</button>)}</div>
    </>}
    {!isAuthReady ? <div className="readiness-step" role="status">Checking your sign-in…</div> : !isAuthenticated ? <div className="trading-readiness">
      <div className="readiness-step"><span className="readiness-number">A</span><div><strong>Authentication required</strong><p>Sign in before opening an order form. Thesis details remain available while logged out.</p></div></div>
      <Link className="primary-trade readiness-link" href={logInHref}>Log in to trade</Link>
    </div> : <>
    <div className="trading-readiness" aria-label="Trading readiness">
      <div className="readiness-step readiness-complete"><span className="readiness-number">A</span><div><strong>Authentication verified</strong><p>Signed in through Privy.</p></div></div>
      <div className={`readiness-step ${walletMatchesAccount && testnetVerified ? "readiness-complete" : ""}`}><span className="readiness-number">B</span><div><strong>{walletMatchesAccount ? `Phantom · ${abbreviatedAddress(connectedPhantom!.address)}` : "Connect Phantom"}</strong><p>{walletConnecting ? "Waiting for Phantom approval…" : walletMatchesAccount ? agentState.mode === "ready" ? "Wallet linked. A revocable trade-only agent handles Pacifica’s per-leg signatures; Phantom will ask you once for each reviewed thesis trade." : "Wallet ownership verified. Enable THESIS’s trade-only Pacifica agent once; then Phantom will ask you once for each reviewed thesis trade." : "Connect and link your Phantom Solana wallet."}</p>{!walletMatchesAccount && <button className="readiness-action" disabled={walletConnecting} onClick={connectPhantom}>{walletConnecting ? "Connecting…" : "Connect Phantom"}</button>}{walletMatchesAccount && agentState.mode === "loading" && <p role="status">Checking one-confirmation trading setup…</p>}{walletMatchesAccount && agentState.mode === "unbound" && <button className="readiness-action" disabled={agentConnecting} onClick={enableTradeAgent}>{agentConnecting ? "Waiting for Phantom…" : "Enable one-confirmation trading"}</button>}{walletMatchesAccount && agentState.mode === "error" && <p className="wallet-menu-error" role="alert">{agentState.message}</p>}{walletMessage && <p className="wallet-menu-error" role="status">{walletMessage}{walletMessage.includes("isn't available") && <> <a href="https://phantom.com/download" target="_blank" rel="noreferrer">Install Phantom</a></>}</p>}</div></div>
      <div className={`readiness-step ${hasFunding ? "readiness-complete" : ""}`}><span className="readiness-number">C</span><div><strong>Pacifica testnet collateral</strong>{accountState.mode === "loading" ? <p role="status">Verifying collateral from your linked Pacifica testnet account…</p> : accountState.mode === "error" ? <p role="alert">{accountState.message}</p> : accountState.mode === "ready" && Number.isFinite(availableCollateral) ? <><p>Pacifica available collateral: <b>${availableCollateral.toFixed(2)}</b> · wallet balance is separate.</p>{!hasFunding && <><p>Fund your own Pacifica testnet trading account before opening a position. Deposit transactions are not configured in THESIS yet.</p><button type="button" className="readiness-action" disabled>Deposit testnet funds · not configured</button></>}</> : <p>Connect Phantom to check the linked Pacifica testnet account balance.</p>}</div></div>
      <div className={`readiness-step ${readinessReady ? "readiness-complete" : ""}`}><span className="readiness-number">D</span><div><strong>{readinessReady ? "Ready to review" : "Trading checks pending"}</strong><p>Orders require your linked Phantom wallet, enabled trade-only agent, your own Pacifica testnet collateral, fresh prices, and one wallet approval for the reviewed thesis trade.</p></div></div>
    </div>
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

    {!reviewing && !result && <button className="primary-trade" disabled={loading} onClick={() => setReviewing(true)}>{`Review ${side === "long" ? "long" : "short"}`}</button>}
    {reviewing && <div className="inline-info" role="group" aria-label="Confirm thesis order"><strong>Review {side} position</strong><p>${amount} collateral at {leverage}x, approximately ${preview.exposure} exposure across {thesis.assets.length} legs. {readinessReady ? "Confirm opens Phantom once to approve the complete thesis trade; THESIS submits the signed market legs together." : "This is a preview only. Confirm is disabled until the pending trading checks above pass."}</p><button className="primary-trade" disabled={disabled || !readinessReady} onClick={openPosition}>{loading ? (actionMessage.startsWith("Approve") ? "Waiting for Phantom…" : "Submitting…") : `Confirm and go ${side}`}</button><button className="portfolio-discover" disabled={loading} onClick={() => setReviewing(false)}>Back</button></div>}
    {actionMessage && <div className="inline-info" role={result?.status === "submission_unknown" ? "alert" : "status"}>{actionMessage}{actionMessage.includes("Sign in") && <> <Link href={logInHref}>Sign in</Link></>}{result?.providerCode !== undefined && <div>Pacifica error code: {result.providerCode}{result.providerHttpStatus ? ` (HTTP ${result.providerHttpStatus})` : ""}{result.providerMessage ? ` — ${result.providerMessage}` : ""}</div>}</div>}
    {result?.results?.length ? <div className="portfolio-legs" aria-label="Per-leg trade results">{result.results.map((row) => <div className="portfolio-leg" key={row.symbol}><span><strong>{row.symbol}</strong></span><span>{row.status.replaceAll("_", " ")}</span><span>{row.fillQuantity ? `${row.fillQuantity} filled` : row.quantity ?? "—"}</span><span>{row.fillPrice ? `Fill $${row.fillPrice}` : row.status === "accepted_unconfirmed" ? "Fill unconfirmed" : "—"}</span></div>)}</div> : null}
    {result?.allocationId && <Link className="portfolio-discover" href="/portfolio">View Portfolio</Link>}
    {result?.leverageVerification?.verified === false && <div className="warning-box" role="alert">Observed implied leverage was {result.leverageVerification.impliedLeverage}x; expected {result.leverageVerification.expectedLeverage}x. Review the exchange account before opening another trade.</div>}
    <p className="trade-disclaimer">Orders go only to Pacifica testnet for the linked wallet. THESIS never receives your main wallet private key. The revocable trade-only agent signs each Pacifica order after Phantom approves the exact reviewed thesis trade.</p>
    </>}
  </aside>;
}
