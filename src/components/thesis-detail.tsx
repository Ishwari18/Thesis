"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Point, Thesis } from "@/lib/types";
import { TradePanel } from "./trade-panel";

function periodData(thesis: Thesis, period: string): Point[] {
  if (period === "ALL") return thesis.series;
  const count = period === "1D" ? 25 : period === "1W" ? 8 : 31;
  const labels = period === "1D" ? Array.from({length: count}, (_,i)=>`${String(i).padStart(2,"0")}:00`) : period === "1W" ? ["Mon","Tue","Wed","Thu","Fri","Sat","Sun","Today"] : Array.from({length: count},(_,i)=>`${i+1}`);
  const seed = thesis.slug.split("").reduce((sum,c)=>sum+c.charCodeAt(0),0);
  const totalReturn = period === "1D" ? .008 : period === "1W" ? .023 : .067;
  const values = Array.from({length:count},(_,i)=>{const progress=i/(count-1); const noise=Math.sin((i+seed)*.63)*.006+Math.sin((i+seed)*.19)*.004; return 100*(1+totalReturn*progress+noise*Math.sin(Math.PI*progress));});
  values[0]=100; values[count-1]=100*(1+totalReturn);
  return values.map((value,i)=>({date:labels[i],value:Math.round(value*100)/100}));
}

export function ThesisDetail({thesis:t}:{thesis:Thesis}) {
  const [period,setPeriod]=useState("ALL"), [mandate,setMandate]=useState(false), [allAssets,setAllAssets]=useState(false), [activeTab,setActiveTab]=useState("Overview");
  const data=useMemo(()=>periodData(t,period),[period,t]);
  const change=(data.at(-1)!.value/data[0].value-1)*100;
  const assets=allAssets?t.assets:t.assets.slice(0,4);
  return <>
    <div className="back-line"><Link href="/discover"><ArrowLeft size={14}/> All theses</Link><span>THESIS / {t.name.toUpperCase()}</span></div>
    <div className="detail-grid"><div className="detail-main">
      <section className="detail-intro"><div className="thesis-avatar large" style={{"--avatar":t.color} as React.CSSProperties}>{t.initials}</div><div><div className="eyebrow">{t.category.toUpperCase()} · DEMO THESIS</div><h1>{t.name}</h1><p>{t.summary}</p></div></section>
      <section className="performance-section"><div className="performance-top"><div><div className="eyebrow">SIMULATED THESIS PERFORMANCE</div><div className={`hero-return ${change>=0?"positive":"negative"}`}>{change>=0?"+":""}{change.toFixed(1)}<span>%</span></div><small className="period-caption">{period==="ALL"?"ALL TIME":"OVER THE LAST "+period}</small></div><div className="period-controls">{["1D","1W","1M","ALL"].map(p=><button key={p} className={period===p?"active":""} onClick={()=>setPeriod(p)}>{p}</button>)}</div></div>
        <div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><AreaChart data={data} margin={{top:16,right:10,bottom:0,left:-18}}><defs><linearGradient id="thesisFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={change>=0?"#80c5a0":"#dc817c"} stopOpacity={.16}/><stop offset="100%" stopColor={change>=0?"#80c5a0":"#dc817c"} stopOpacity={0}/></linearGradient></defs><CartesianGrid vertical={false} stroke="#232727"/><XAxis dataKey="date" axisLine={false} tickLine={false} tick={{fill:"#737b78",fontSize:10}} interval="preserveStartEnd"/><YAxis orientation="right" axisLine={false} tickLine={false} tick={{fill:"#737b78",fontSize:10}} tickFormatter={v=>`${v.toFixed(0)}`} domain={["dataMin - 8","dataMax + 8"]}/><Tooltip contentStyle={{background:"#171a19",border:"1px solid #303633",borderRadius:8,fontSize:12}} labelStyle={{color:"#9da4a0"}} formatter={(v:number)=>[`${v.toFixed(2)} index`,"Demo"]}/><Area type="monotone" dataKey="value" stroke={change>=0?"#82c9a2":"#dc817c"} strokeWidth={1.8} fill="url(#thesisFill)" dot={false} activeDot={{r:3,fill:change>=0?"#a0dbb9":"#e6a19c",stroke:"#111"}}/></AreaChart></ResponsiveContainer></div><div className="chart-foot"><span>Illustrative normalized index · 100 at start</span><span>DEMO DATA</span></div>
      </section>
      <div className="detail-tabs">{["Overview","Activity","Rebalances"].map(tab=><button key={tab} onClick={()=>setActiveTab(tab)} className={activeTab===tab?"active":""}>{tab}</button>)}</div>
      {activeTab==="Overview"?<>
        <section className="content-section idea-section"><div className="section-kicker">IDEA <span>01</span></div><div><h2>Why this thesis</h2><p>{t.idea}</p><button className="mandate-toggle" onClick={()=>setMandate(!mandate)}>{mandate?"Close working mandate":"Read the working mandate"}<ChevronRight size={14} className={mandate?"down":""}/></button>{mandate&&<div className="mandate-copy">{t.mandate.split("\n\n").map((p,i)=><p key={i}>{p}</p>)}</div>}</div></section>
        <section className="content-section how-section"><div className="section-kicker">HOW IT<br/>WORKS <span>02</span></div><div><h2>Operating details</h2>{[["Tracks",t.tracks],["Rebalancing",t.rebalancing],["Posture",t.posture],["Leverage model",t.leverageModel],["Coverage",t.coverage]].filter(([,v])=>v).map(([k,v])=><div className="fact-row" key={k}><span>{k}</span><strong>{v}</strong></div>)}</div></section>
        <section className="content-section holdings-section"><div className="section-kicker">HOLDINGS <span>03</span></div><div><div className="holdings-title"><div><h2>Target composition</h2><p>Illustrative weights · not live positions</p></div><button onClick={()=>setAllAssets(!allAssets)}>{allAssets?"Show less":"Show all"}</button></div><div className="allocation-bar">{t.assets.map(a=><span key={a.symbol} style={{width:`${Number(a.weight)*100}%`,background:a.color}} title={`${a.symbol} ${(Number(a.weight)*100).toFixed(0)}%`}/>)}</div><div className="holdings-list">{assets.map(a=><div className="holding-row" key={a.symbol}><span className="holding-name"><i style={{background:a.color}}/>{a.symbol}<small>{a.direction}</small></span><span className="holding-pct">{(Number(a.weight)*100).toFixed(0)}%</span><span className="holding-min">Market min ${a.minNotional}</span></div>)}</div></div></section>
      </>:<section className="sample-activity"><div className="activity-demo-label">DEMO ACTIVITY · NO EXCHANGE ORDERS</div><h2>{activeTab==="Activity"?"Sample thesis activity":"No rebalances recorded"}</h2><p>{activeTab==="Activity"?"Demo basket initialized from illustrative weights. This record is sample data and is not a live trade history.":"This thesis has no rebalancing policy configured in demo mode."}</p></section>}
      <div className="accounting-note">Thesis performance is simulated separately from any user&apos;s personal trading P&amp;L.</div>
    </div><TradePanel thesis={t}/></div>
  </>;
}
