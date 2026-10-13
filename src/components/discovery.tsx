"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import type { Thesis } from "@/lib/types";
import { THESIS_COVER_IMAGES } from "@/lib/thesis-covers";
import { MarketIdentity } from "./market-identity";

export function Discovery({ theses }: { theses: Thesis[] }) {
  const router = useRouter();
  const { ready: authReady, authenticated } = usePrivy();
  const visible = [...theses].sort((a, b) => b.published.localeCompare(a.published));

  return (
    <>
      <div className="thesis-list">
        {visible.map((t, i) => (
          <Link className="thesis-row" href={`/theses/${t.slug}`} key={t.slug}>
            <span className="thesis-primary">
              <span className="rank">{String(i + 1).padStart(2, "0")}</span>
              <span className="thesis-card-copy">
                <strong className="row-title">{t.name}</strong>
                {THESIS_COVER_IMAGES[t.slug] && <Image className="thesis-card-image" src={THESIS_COVER_IMAGES[t.slug]} alt={`${t.name} cover`} width={164} height={164} unoptimized loading="eager" />}
              </span>
            </span>

            <span className="asset-icons" aria-label="Thesis constituent logos">
              {t.assets.map((a) => (
                <MarketIdentity key={a.symbol} symbol={a.symbol} variant="compact" />
              ))}
            </span>

            <span className="trade-link discover-trade-button" role="button" tabIndex={0} onClick={(event) => {
              event.preventDefault();
              const destination = `/theses/${t.slug}?trade=1`;
              router.push(authReady && authenticated ? destination : `/auth?next=${encodeURIComponent(destination)}`);
            }} onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                const destination = `/theses/${t.slug}?trade=1`;
                router.push(authReady && authenticated ? destination : `/auth?next=${encodeURIComponent(destination)}`);
              }
            }}>
              Trade
            </span>
          </Link>
        ))}

        {visible.length === 0 && (
          <div className="empty-state">
            <strong>No theses available</strong>
          </div>
        )}
      </div>

      <div className="list-footnote">
        Logos by <a href="https://logo.dev" target="_blank" rel="noreferrer">Logo.dev</a>.
      </div>
    </>
  );
}
