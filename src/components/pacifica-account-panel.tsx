"use client";
import { useEffect, useState } from "react";

type AccountPayload = {
  source: "pacifica-testnet";
  account: { equity?: string; availableBalance?: string; marginUsed?: string };
  positions: Array<{ symbol: string; direction: "long" | "short"; quantity: string; entryPrice: string }>;
};
export function PacificaAccountPanel() {
  const [payload, setPayload] = useState<AccountPayload | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "unavailable">("loading");
  useEffect(() => {
    let cancelled = false;
    fetch("/api/pacifica/account", { cache: "no-store" })
      .then(async response => {
        const data = await response.json() as AccountPayload;
        if (!response.ok) throw new Error("unavailable");
        if (!cancelled) { setPayload(data); setState("ready"); }
      })
      .catch(() => { if (!cancelled) setState("unavailable"); });
    return () => { cancelled = true; };
  }, []);

  return <section className="pacifica-account-card">
    <div className="portfolio-card-head"><div><div className="eyebrow">PACIFICA TESTNET</div><h2>Exchange account</h2></div><span className="portfolio-status">{state === "loading" ? "Loading" : state === "ready" ? "Connected" : "Unavailable"}</span></div>
    {state === "loading" && <p className="portfolio-note">Reading the configured testnet account.</p>}
    {state === "unavailable" && <p className="portfolio-note">Account data is unavailable for this signed-in user or is not configured.</p>}
    {payload && <>
      <div className="portfolio-metrics"><span>Equity <strong>{payload.account.equity ?? "—"}</strong></span><span>Available <strong>{payload.account.availableBalance ?? "—"}</strong></span><span>Margin used <strong>{payload.account.marginUsed ?? "—"}</strong></span></div>
      <div className="portfolio-legs">{payload.positions.length ? payload.positions.map(position => <div className="portfolio-leg" key={position.symbol}><span>{position.symbol} <small>{position.direction}</small></span><span>Qty {position.quantity}</span><span>Entry {position.entryPrice}</span></div>) : <p className="portfolio-note">No open net account positions reported.</p>}</div>
      <p className="portfolio-note">These are exchange account-level net positions. They are not attributed to individual thesis allocations.</p>
    </>}
  </section>;
}
