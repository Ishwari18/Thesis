"use client";
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Info, ShieldAlert } from "lucide-react";
import type { Thesis } from "@/lib/types";
import type { LiveAllocationContext } from "@/server/services/allocation";
import { previewAllocation } from "@/server/services/allocation";

type MarketResponse={mode:"demo"|"live-testnet"|"error";source?:"pacifica-testnet";markets?:LiveAllocationContext["markets"];quotes?:LiveAllocationContext["quotes"];message?:string};
export function TradePanel({thesis}:{thesis:Thesis}) {
  const [amount,setAmount]=useState("100"),[leverage,setLeverage]=useState(3),[expanded,setExpanded]=useState(false),[showInfo,setShowInfo]=useState(false),[demoMessage,setDemoMessage]=useState(false);
  const [marketResponse,setMarketResponse]=useState<MarketResponse>({mode:"demo"});
  const symbols=useMemo(()=>thesis.assets.map(a=>a.symbol),[thesis.assets]);
  useEffect(()=>{const params=new URLSearchParams();symbols.forEach(symbol=>params.append("symbol",symbol));let cancelled=false;fetch(`/api/pacifica/markets?${params.toString()}`,{cache:"no-store"}).then(async r=>{const data=await r.json() as MarketResponse;if(!cancelled)setMarketResponse(r.ok?data:{mode:"error",message:data.message??"Pacifica market data unavailable."});}).catch(()=>{if(!cancelled)setMarketResponse({mode:"error",message:"Pacifica market data unavailable. Demo preview only."});});return()=>{cancelled=true;};},[symbols]);
  const live=marketResponse.mode==="live-testnet"&&marketResponse.markets&&marketResponse.quotes?{source:"pacifica-testnet" as const,markets:marketResponse.markets,quotes:marketResponse.quotes}:undefined;
  const preview=previewAllocation(thesis,amount,leverage,live);
  const label=live?"PACIFICA TESTNET":marketResponse.mode==="error"?"DEMO ONLY":"DEMO";
  return <aside className="trade-panel">
    <div className="panel-head"><div><div className="eyebrow">BUILD YOUR POSITION</div><h2>Trade thesis</h2></div><span className="demo-tag">{label}</span></div>
    <div className="field-label">Collateral <span>USD</span></div><div className="amount-input"><span>$</span><input inputMode="decimal" value={amount} onChange={e=>{setAmount(e.target.value);setDemoMessage(false);}} aria-label="Collateral amount"/><button onClick={()=>setAmount("1000")}>MAX</button></div>
    <div className="field-label leverage-label">Leverage <button className="info-button" onClick={()=>setShowInfo(!showInfo)} aria-label="About leverage"><Info size={13}/></button></div><div className="leverage-options">{[2,3,5].map(n=><button className={leverage===n?"selected":""} key={n} onClick={()=>{setLeverage(n);setDemoMessage(false);}}>{n}x</button>)}</div>
    {showInfo&&<div className="inline-info">Leverage multiplies exposure and increases both potential gains and losses. Demo preview only.</div>}
    <div className="exposure-line"><span>Approx. exposure</span><strong>${preview.exposure??"0.00"}</strong></div>
    <button className="allocation-toggle" onClick={()=>setExpanded(!expanded)}><span>Allocation preview <small>{thesis.assets.length} assets</small></span><ChevronDown size={15} className={expanded?"rotated":""}/></button>
    {expanded&&<div className="allocation-legs">{preview.legs.map(l=><div className="allocation-leg" key={l.symbol}><span className="leg-symbol">{l.symbol}</span><span className="leg-weight">{(Number(l.weight)*100).toFixed(0)}%</span><strong>${l.notional??l.targetNotional}</strong>{l.quantity&&<small className="leg-quantity">{l.quantity} units</small>}{!l.eligible&&<small className="leg-warning">Min ${l.minimum}</small>}</div>)}</div>}
    {preview.error&&<div className="warning-box"><ShieldAlert size={14}/><span>{preview.error}</span></div>}
    {marketResponse.mode==="error"&&<div className="inline-info" role="status">{marketResponse.message} Showing only the labeled demo preview.</div>}
    <button className="primary-trade" onClick={()=>setDemoMessage(true)}>Trade in demo</button>
    {demoMessage&&<div className="inline-info" role="status">{live?"Testnet execution is disabled in this build.":"Demo execution is not enabled."} No order was submitted or position created.</div>}
    <p className="trade-disclaimer">{live?"Live testnet market data. No order will be submitted; Pacifica execution is disabled by default.":"Demo only. No order will be submitted and no position is created. Fees and execution rounding are not included."}</p>
    <div className="minimum-note"><Info size={13}/><span>{live?"Market minimums, lot sizes and mark prices are fetched from Pacifica testnet.":"Demo market metadata is illustrative; testnet execution is unavailable."}</span></div>
  </aside>;
}
