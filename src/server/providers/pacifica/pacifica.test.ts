
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import bs58 from "bs58";
import nacl from "tweetnacl";
import {
  canonicalSigningMessage,
  createSigningIdentity,
  loadPacificaSigningIdentity,
  signPacificaAction,
} from "./signing";
import { readPacificaConfig, requireExecutionConfig } from "./config";
import { createPacificaClient } from "./client";
import { fetchPacificaSnapshot, resetPacificaMarketCache } from "./market-data";
import { normalizeBatchResults } from "./orders";
import { previewAllocation } from "@/server/services/allocation";
import type { Thesis } from "@/lib/types";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getPacificaAccount } from "./account";
import { getPacificaPositions } from "./positions";

const allocationTestThesis = {
  slug: "allocation-test",
  name: "Allocation Test",
  assets: [
    {
      symbol: "NVDA",
      weight: "1",
      direction: "long" as const,
      active: true,
      maxLeverage: 5,
      minNotional: "55",
    },
  ],
} as Thesis;

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env.PACIFICA_NETWORK = "testnet";
  process.env.PACIFICA_API_BASE_URL = "https://test-api.pacifica.fi";
  process.env.PACIFICA_MARKET_DATA_ENABLED = "true";
  process.env.PACIFICA_TESTNET_EXECUTION_ENABLED = "false";
  resetPacificaMarketCache();
});

afterEach(() => {
  process.env = { ...originalEnv };
  resetPacificaMarketCache();
  vi.restoreAllMocks();
});

const ok = (data: unknown) =>
  new Response(JSON.stringify({ success: true, data, error: null, code: null }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const fixtureMarket = {
  symbol: "NVDA",
  tick_size: "0.01",
  lot_size: "0.001",
  min_order_size: "10",
  max_order_size: "1000000",
  max_leverage: 10,
  instrument_type: "perpetual",
  base_asset: "NVDA",
};

const fixtureQuote = {
  symbol: "NVDA",
  mark: "120.5",
  mid: "120.6",
  oracle: "120.5",
  timestamp: Date.now(),
  funding: "0",
  next_funding: "0",
};

describe("Pacifica testnet signing", () => {
  it("matches recursive key ordering, compact JSON and Ed25519 base58 signing", () => {
    const seed = new Uint8Array(32).fill(7);
    const kp = nacl.sign.keyPair.fromSeed(seed);
    const encoded = bs58.encode(kp.secretKey);
    const address = bs58.encode(kp.publicKey);
    const identity = createSigningIdentity(encoded, address);
    const data = {
      symbol: "NVDA",
      amount: "0.1",
      side: "bid",
      reduce_only: false,
    };

    const body = signPacificaAction("create_market_order", data, identity, 12345, 5000);
    const message = canonicalSigningMessage("create_market_order", data, 12345, 5000);

    expect(body).toMatchObject({
      account: address,
      agent_wallet: null,
      timestamp: 12345,
      expiry_window: 5000,
      ...data,
    });
    expect(
      nacl.sign.detached.verify(
        new TextEncoder().encode(message),
        bs58.decode(body.signature),
        kp.publicKey,
      ),
    ).toBe(true);
    expect(message).toBe(
      '{"data":{"amount":"0.1","reduce_only":false,"side":"bid","symbol":"NVDA"},"expiry_window":5000,"timestamp":12345,"type":"create_market_order"}',
    );
  });

  it("rejects invalid or mismatched signing configuration", () => {
    expect(() => createSigningIdentity("not-a-key", "address")).toThrow(
      /base58-encoded/,
    );
    expect(() =>
      createSigningIdentity(bs58.encode(new Uint8Array(32)), "address"),
    ).toThrow(/64-byte/);

    const key = bs58.encode(
      nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(9)).secretKey,
    );
    expect(() => createSigningIdentity(key, "wrong-address")).toThrow(
      /does not match/,
    );
    expect(() => loadPacificaSigningIdentity(undefined, undefined)).toThrow(
      /Configure the Pacifica testnet/,
    );
  });

  it("keeps execution disabled unless explicitly enabled with all config", () => {
    expect(() => requireExecutionConfig(readPacificaConfig())).toThrow(
      /execution is disabled/,
    );

    process.env.PACIFICA_TESTNET_EXECUTION_ENABLED = "true";
    expect(() => requireExecutionConfig(readPacificaConfig())).toThrow(
      /requires PACIFICA_ACCOUNT_ADDRESS/,
    );

    process.env.PACIFICA_NETWORK = "mainnet";
    expect(() => readPacificaConfig()).toThrow(/restricted to testnet/);
  });
});

describe("Pacifica market data and transport", () => {
  it("normalizes market limits, lot size, live quote and freshness from documented endpoints", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(ok([fixtureMarket]))
      .mockResolvedValueOnce(ok([fixtureQuote]));

    const snapshot = await fetchPacificaSnapshot(
      {
        get: async <T>(path: string) => {
          const response = await fetcher();
          void path;
          return (await response.json()) as T;
        },
        post: async <T>() => ({} as T),
      },
      Date.now(),
    );

    expect(snapshot.markets[0]).toMatchObject({
      symbol: "NVDA",
      active: true,
      minNotional: "10",
      lotSize: "0.001",
      tickSize: "0.01",
      maxLeverage: 10,
      source: "pacifica-testnet",
    });
    expect(snapshot.quotes[0]).toMatchObject({
      symbol: "NVDA",
      markPrice: "120.5",
      midPrice: "120.6",
      fresh: true,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("blocks public data when the market-data opt-in is off", async () => {
    process.env.PACIFICA_MARKET_DATA_ENABLED = "false";
    await expect(
      fetchPacificaSnapshot({ get: vi.fn(), post: vi.fn() }),
    ).rejects.toThrow(/market data is disabled/);
  });

  it("fails closed on malformed exchange envelopes", async () => {
    await expect(
      fetchPacificaSnapshot({
        get: async <T>() => ({ success: false, data: [] }) as T,
        post: async <T>() => ({} as T),
      }),
    ).rejects.toThrow(/market info response was invalid/);
  });

  it("normalizes timeouts and HTTP errors without exposing payloads", async () => {
    const http = createPacificaClient(
      async () =>
        new Response(JSON.stringify({ error: "private response details" }), {
          status: 503,
        }),
    );

    await expect(http.get("/api/v1/info")).rejects.toThrow(
      "Pacifica testnet returned HTTP 503.",
    );

    const timeout = createPacificaClient(async () => {
      const error = new Error("aborted");
      error.name = "TimeoutError";
      throw error;
    });

    await expect(timeout.get("/api/v1/info")).rejects.toThrow(
      "Pacifica testnet request timed out.",
    );
  });

  it("normalizes account and net symbol positions without thesis attribution", async () => {
    const account = "11111111111111111111111111111111";
    process.env.PACIFICA_ACCOUNT_ADDRESS = account;

    const client = {
      get: async <T>(path: string) =>
        path.endsWith("/account")
          ? ({
              success: true,
              data: {
                account_equity: "120.00",
                available_to_spend: "90.00",
                total_margin_used: "30.00",
                balance: "100.00",
                updated_at: Date.now(),
              },
            }) as T
          : ({
              success: true,
              data: [
                {
                  symbol: "NVDA",
                  side: "ask",
                  amount: "0.5",
                  entry_price: "100",
                  funding: "-0.25",
                  isolated: false,
                  liquidation_price: null,
                  created_at: Date.now(),
                  li: 3,
                },
              ],
            }) as T,
      post: async <T>() => ({} as T),
    };

    const balance = await getPacificaAccount(client);
    const positions = await getPacificaPositions(client);

    expect(balance).toMatchObject({
      address: account,
      equity: "120.00",
      availableBalance: "90.00",
      marginUsed: "30.00",
      source: "pacifica-testnet",
    });
    expect(positions[0]).toMatchObject({
      symbol: "NVDA",
      side: "ask",
      direction: "short",
      quantity: "0.5",
      entryPrice: "100",
      fundingPaid: "-0.25",
    });
    expect(positions[0]).not.toHaveProperty("thesisId");
  });

  it("inspects every batch result and blocks incomplete results", () => {
    expect(
      normalizeBatchResults(
        {
          success: true,
          data: {
            results: [
              { success: true, order_id: 42 },
              { success: false, error: "bad leg" },
            ],
          },
        },
        2,
      ),
    ).toEqual([
      { status: "accepted", externalId: "42" },
      { status: "rejected", error: "Pacifica rejected this action." },
    ]);

    expect(() =>
      normalizeBatchResults(
        { success: true, data: { results: [{ success: true }] } },
        2,
      ),
    ).toThrow(/incomplete batch result/);
  });

  it("uses live min-notional, freshness, leverage and lot rounding in STRICT allocation preview", () => {
    const now = Date.now();

    const markets = allocationTestThesis.assets.map((asset) => ({
      symbol: asset.symbol,
      exchangeId: asset.symbol,
      active: true,
      instrumentType: "perpetual",
      minNotional: "55",
      lotSize: "0.5",
      tickSize: "0.01",
      maxLeverage: 5,
      observedAt: new Date(now).toISOString(),
      source: "pacifica-testnet" as const,
    }));

    const quotes = allocationTestThesis.assets.map((asset) => ({
      symbol: asset.symbol,
      markPrice: "100",
      observedAt: new Date(now).toISOString(),
      fresh: true,
      source: "pacifica-testnet" as const,
    }));

    const result = previewAllocation(allocationTestThesis, "25", 2, {
      markets,
      quotes,
      source: "pacifica-testnet",
    });

    expect(result.source).toBe("pacifica-testnet");
    expect(result.legs[0]).toMatchObject({
      quantity: "0.5",
      notional: "50.00",
      minimum: "55.00",
      eligible: false,
    });

    const stale = {
      markets: markets.map((market, index) =>
        index === 0
          ? { ...market, observedAt: "2020-01-01T00:00:00.000Z" }
          : market,
      ),
      quotes,
    };

    expect(
      previewAllocation(allocationTestThesis, "25", 2, {
        ...stale,
        source: "pacifica-testnet",
      }).error,
    ).toMatch(/missing or stale/);
  });

  it("does not expose Pacifica signing environment names in client code", () => {
    const readTree = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = join(dir, entry.name);

        return entry.isDirectory()
          ? readTree(full)
          : /\.(tsx?|jsx?)$/.test(entry.name)
            ? [readFileSync(full, "utf8")]
            : [];
      });

    const clientFiles = [
      ...readTree(join(process.cwd(), "src", "components")),
      ...readTree(join(process.cwd(), "src", "app")),
    ].join("\n");

    expect(clientFiles).not.toContain("PACIFICA_PRIVATE_KEY");
    expect(clientFiles).not.toContain("PACIFICA_ACCOUNT_ADDRESS");
  });
});
