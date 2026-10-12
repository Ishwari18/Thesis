"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { Search, ArrowUpDown, ArrowUpRight } from "lucide-react";
import type { Thesis } from "@/lib/types";
import {
  LivePrice,
  useLiveThesisPrices,
} from "./market-data/live-thesis-prices";

export function Discovery({ theses }: { theses: Thesis[] }) {
  const router = useRouter();
  const { ready: authReady, authenticated } = usePrivy();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All themes");
  const [sort, setSort] = useState("recent");
  const { prices } = useLiveThesisPrices(theses);

  const categories = [
    "All themes",
    ...Array.from(new Set(theses.map((t) => t.category))),
  ];

  const visible = useMemo(
    () =>
      theses
        .filter(
          (t) =>
            (category === "All themes" || t.category === category) &&
            `${t.name} ${t.summary} ${t.category}`
              .toLowerCase()
              .includes(query.toLowerCase())
        )
        .sort((a, b) => sort === "recent" ? b.published.localeCompare(a.published) : a.name.localeCompare(b.name)),
    [theses, query, category, sort]
  );

  return (
    <>
      <div className="explore-controls">
        <label className="inline-search">
          <Search size={14} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search narratives"
          />
        </label>

        <div className="control-group">
          <select
            aria-label="Filter category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {categories.map((c) => <option key={c}>{c}</option>)}
          </select>

          <button
            className="sort-control"
            onClick={() =>
              setSort(sort === "recent" ? "name" : "recent")
            }
          >
            <ArrowUpDown size={13} />
            {sort === "recent" ? "Recently published" : "Name"}
          </button>
        </div>
      </div>

      <div className="list-labels">
        <span>THESIS</span>
        <span>COMPOSITION</span>
        <span>LIVE MARKETS</span>
        <span>THESIS PERFORMANCE</span>
        <span />
      </div>

      <div className="thesis-list">
        {visible.map((t, i) => (
          <Link className="thesis-row" href={`/theses/${t.slug}`} key={t.slug}>
            <span className="rank">{String(i + 1).padStart(2, "0")}</span>

            <span
              className="thesis-avatar"
              style={{ "--avatar": t.color } as React.CSSProperties}
            >
              {t.initials}
            </span>

            <span className="row-title">
              <strong>{t.name}</strong>
              <small>{t.category} · {t.horizon}</small>
            </span>

            <span className="asset-icons">
              {t.assets.slice(0, 4).map((a) => (
                <span
                  title={a.symbol}
                  key={a.symbol}
                  style={{ "--asset": a.color } as React.CSSProperties}
                >
                  {a.symbol.slice(0, 1)}
                </span>
              ))}
              <small>{t.assets.map((a) => a.symbol).join(" · ")}</small>
            </span>

            <span className="live-price-list">
              {t.assets.slice(0, 3).map((a) => (
                <span key={a.symbol}>
                  <small>{a.symbol}</small>
                  <LivePrice symbol={a.symbol} prices={prices} />
                </span>
              ))}
              {t.assets.length > 3 && (
                <small>+{t.assets.length - 3} more · Open thesis</small>
              )}
            </span>

            <span className="row-return performance-unavailable">
              Unavailable
              <small>NO EQUITY HISTORY</small>
            </span>

            <span className="trade-link" role="button" tabIndex={0} onClick={(event) => {
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
              Trade <ArrowUpRight size={14} />
            </span>
          </Link>
        ))}

        {visible.length === 0 && (
          <div className="empty-state">
            <div className="empty-icon"><Search size={18} /></div>
            <strong>No narratives found</strong>
            <span>Try another search or category.</span>
            <button onClick={() => {
              setQuery("");
              setCategory("All themes");
            }}>
              Clear filters
            </button>
          </div>
        )}
      </div>

      <div className="list-footnote">
        Constituent market prices use Pacifica testnet when enabled. Thesis
        performance is unavailable without reliable historical positions.
      </div>
    </>
  );
}
