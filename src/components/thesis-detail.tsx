"use client";

import Link from "next/link";
import Image from "next/image";
import { ArrowLeft } from "lucide-react";
import type { Thesis } from "@/lib/types";
import { THESIS_COVER_IMAGES } from "@/lib/thesis-covers";
import { TradePanel } from "./trade-panel";
import { ThesisPerformanceChart } from "./thesis-performance-chart";

export function ThesisDetail({ thesis: t }: { thesis: Thesis }) {
  return <>
    <div className="back-line"><Link href="/discover"><ArrowLeft size={14}/> All theses</Link><span>THESIS / {t.name.toUpperCase()}</span></div>
    <div className="detail-grid"><div className="detail-main">
      <section className="detail-intro"><div className="thesis-avatar large thesis-detail-avatar" style={{ "--avatar": t.color } as React.CSSProperties}>{THESIS_COVER_IMAGES[t.slug] ? <Image src={THESIS_COVER_IMAGES[t.slug]} alt="" width={44} height={44} unoptimized aria-hidden="true" /> : t.initials}</div><div><h1>{t.name}</h1><p>{t.summary}</p></div></section>
      <ThesisPerformanceChart thesisSlug={t.slug} thesisName={t.name}/>
      <div className="detail-tabs"><span className="active overview-tab">Overview</span></div>
        <section className="target-composition-section"><div className="target-composition-heading"><h2>Target composition</h2><p>Illustrative target weights · not live positions</p></div><div className="target-composition-content"><svg className="target-composition-donut" viewBox="0 0 220 220" role="img" aria-label={`Target composition across ${t.assets.length} assets`}>
          {(() => {
            const total = t.assets.reduce((sum, asset) => sum + Math.max(0, Number(asset.weight)), 0);
            const circumference = 2 * Math.PI * 80;
            let offset = 0;
            return t.assets.map((asset) => {
              const fraction = total > 0 ? Math.max(0, Number(asset.weight)) / total : 0;
              const length = Math.max(0, fraction * circumference - 1.5);
              const circle = <circle key={asset.symbol} cx="110" cy="110" r="80" fill="none" stroke={asset.color} strokeWidth="40" strokeDasharray={`${length} ${circumference - length}`} strokeDashoffset={-offset} transform="rotate(-90 110 110)" />;
              offset += fraction * circumference;
              return circle;
            });
          })()}
        </svg><div className="target-composition-legend">{t.assets.map((asset) => <div className="target-composition-item" key={asset.symbol}><i style={{ background: asset.color }}/><span>{asset.symbol}</span><strong>{(Number(asset.weight) * 100).toFixed(Number(asset.weight) * 100 % 1 === 0 ? 0 : 1)}%</strong></div>)}</div></div></section>
    </div><TradePanel thesis={t}/></div>
  </>;
}
