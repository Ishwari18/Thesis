"use client";

import { useState } from "react";
import { MarketIdentity } from "./market-identity";

type Position = {
  symbol: string;
  direction: "long" | "short";
  quantity: string;
  entryPrice: string;
  liquidationPrice?: string | null;
  fundingPaid?: string;
};

type AccountPayload = {
  source: "pacifica-testnet";
  account: {
    address?: string;
    equity?: string;
    availableBalance?: string;
    marginUsed?: string;
    balance?: string;
    updatedAt?: string;
  };
  positions: Position[];
};

function formatUsd(value?: string | null) {
  if (value == null || !Number.isFinite(Number(value))) return "—";

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 4,
  }).format(Number(value));
}

export function PacificaAccountPanel() {
  const [payload, setPayload] = useState<AccountPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);

  async function fetchAccount() {
    if (loading) return;

    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/pacifica/account", {
        method: "GET",
        cache: "no-store",
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error("Please sign in to THESIS first.");
        }
        if (response.status === 403) {
          throw new Error(
            "This THESIS account is not authorized to read the configured Pacifica testnet account."
          );
        }
        throw new Error(
          data.error ?? "Could not fetch Pacifica account details."
        );
      }

      setPayload(data as AccountPayload);
      setFetchedAt(new Date().toISOString());
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not connect to Pacifica testnet."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="pacifica-account-card">
      <div className="portfolio-card-head">
        <div>
          <div className="eyebrow">PACIFICA TESTNET · TESTING ONLY</div>
          <h2>Exchange net positions (all theses)</h2>
        </div>
        <span className="portfolio-status">
          {loading ? "Fetching…" : payload ? "Fetched" : "Not fetched"}
        </span>
      </div>

      <p className="portfolio-note">
        Account-level Pacifica values and net symbol positions. A shared symbol may include quantities from several theses.
      </p>

      <button
        type="button"
        className="primary-trade"
        onClick={fetchAccount}
        disabled={loading}
      >
        {loading
          ? "Fetching account details…"
          : payload
            ? "Refresh Account Details"
            : "Fetch Account Details"}
      </button>

      {error && (
        <p className="inline-info" role="alert">
          {error}
        </p>
      )}

      {payload && (
        <>
          <div className="portfolio-metrics">
            <span>
              Equity <strong>{formatUsd(payload.account.equity)}</strong>
            </span>
            <span>
              Available{" "}
              <strong>{formatUsd(payload.account.availableBalance)}</strong>
            </span>
            <span>
              Margin used{" "}
              <strong>{formatUsd(payload.account.marginUsed)}</strong>
            </span>
            <span>
              Open positions <strong>{payload.positions.length}</strong>
            </span>
          </div>

          <div className="portfolio-legs">
            {payload.positions.length === 0 ? (
              <p className="portfolio-note">
                Pacifica reports no open positions for this account.
              </p>
            ) : (
              payload.positions.map((position) => (
                <div className="portfolio-leg" key={position.symbol}>
                  <span>
                    <MarketIdentity symbol={position.symbol} variant="compact" />{" "}
                    <small>{position.direction.toUpperCase()}</small>
                  </span>
                  <span>Quantity {position.quantity}</span>
                  <span>Entry {formatUsd(position.entryPrice)}</span>
                  <span>
                    Liquidation{" "}
                    {formatUsd(position.liquidationPrice)}
                  </span>
                  {position.fundingPaid != null && (
                    <span>Funding {formatUsd(position.fundingPaid)}</span>
                  )}
                </div>
              ))
            )}
          </div>

          <p className="portfolio-note">
            Account-level positions reported by Pacifica, not simulated THESIS
            positions. Leverage is not included because the current positions
            API adapter does not return it.
          </p>

          {fetchedAt && (
            <p className="portfolio-note">
              Last fetched: {new Date(fetchedAt).toLocaleString()}
            </p>
          )}

          {payload.account.address && (
            <p className="portfolio-note">
              Configured account:{" "}
              <code>{payload.account.address}</code>
            </p>
          )}
        </>
      )}
    </section>
  );
}
