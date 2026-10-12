"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronRight } from "lucide-react";
import type { Thesis } from "@/lib/types";
import { TradePanel } from "./trade-panel";
import { ThesisPerformanceChart } from "./thesis-performance-chart";

export function ThesisDetail({ thesis: t }: { thesis: Thesis }) {
  const [mandate, setMandate] = useState(false);
  const [allAssets, setAllAssets] = useState(false);
  const [activeTab, setActiveTab] = useState("Overview");
  const assets = allAssets ? t.assets : t.assets.slice(0, 4);
  return <>
    <div className="back-line"><Link href="/discover"><ArrowLeft size={14}/> All theses</Link><span>THESIS / {t.name.toUpperCase()}</span></div>
    <div className="detail-grid"><div className="detail-main">
      <section className="detail-intro"><div className="thesis-avatar large" style={{ "--avatar": t.color } as React.CSSProperties}>{t.initials}</div><div><div className="eyebrow">{t.category.toUpperCase()} · THESIS</div><h1>{t.name}</h1><p>{t.summary}</p></div></section>
      <ThesisPerformanceChart thesisSlug={t.slug} thesisName={t.name}/>
      <div className="detail-tabs">{["Overview", "Activity", "Rebalances"].map((tab) => <button key={tab} onClick={() => setActiveTab(tab)} className={activeTab === tab ? "active" : ""}>{tab}</button>)}</div>
      {activeTab === "Overview" ? <>
        <section className="content-section idea-section"><div className="section-kicker">IDEA <span>01</span></div><div><h2>Why this thesis</h2><p>{t.idea}</p><button className="mandate-toggle" onClick={() => setMandate(!mandate)}>{mandate ? "Close working mandate" : "Read the working mandate"}<ChevronRight size={14} className={mandate ? "down" : ""}/></button>{mandate && <div className="mandate-copy">{t.mandate.split("\n\n").map((p, i) => <p key={i}>{p}</p>)}</div>}</div></section>
        <section className="content-section how-section"><div className="section-kicker">HOW IT<br/>WORKS <span>02</span></div><div><h2>Operating details</h2>{[["Tracks", t.tracks], ["Rebalancing", t.rebalancing], ["Posture", t.posture], ["Leverage model", t.leverageModel], ["Coverage", t.coverage]].filter(([, value]) => value).map(([key, value]) => <div className="fact-row" key={key}><span>{key}</span><strong>{value}</strong></div>)}</div></section>
        <section className="content-section holdings-section"><div className="section-kicker">HOLDINGS <span>03</span></div><div><div className="holdings-title"><div><h2>Target composition</h2><p>Illustrative weights · not live positions</p></div><button onClick={() => setAllAssets(!allAssets)}>{allAssets ? "Show less" : "Show all"}</button></div><div className="allocation-bar">{t.assets.map((asset) => <span key={asset.symbol} style={{ width: `${Number(asset.weight) * 100}%`, background: asset.color }} title={`${asset.symbol} ${(Number(asset.weight) * 100).toFixed(0)}%`}/>)}</div><div className="holdings-list">{assets.map((asset) => <div className="holding-row" key={asset.symbol}><span className="holding-name"><i style={{ background: asset.color }}/>{asset.symbol}<small>{asset.direction}</small></span><span className="holding-pct">{(Number(asset.weight) * 100).toFixed(0)}%</span><span className="holding-min">Market min ${asset.minNotional}</span></div>)}</div></div></section>
      </> : <section className="sample-activity"><h2>{activeTab === "Activity" ? "No thesis activity history" : "No rebalances recorded"}</h2><p>{activeTab === "Activity" ? "The available records do not provide a complete, attributed thesis activity timeline." : "No rebalancing events are recorded for this thesis."}</p></section>}
      <div className="accounting-note">Target composition describes the thesis model. Personal positions and P&amp;L are accounted separately.</div>
    </div><TradePanel thesis={t}/></div>
  </>;
}
