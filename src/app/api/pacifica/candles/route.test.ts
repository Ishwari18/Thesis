import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/providers/pacifica/config", () => ({ readPacificaConfig: () => ({ marketDataEnabled: true, websocketUrl: "wss://test-ws.pacifica.fi/ws" }) }));
vi.mock("@/server/providers/pacifica/market-data", () => ({ fetchPacificaSnapshot: vi.fn(async () => ({ source: "pacifica-testnet", markets: [{ symbol: "BTC" }] })) }));
vi.mock("@/server/providers/pacifica/candles", () => ({ getPacificaMarkCandles: vi.fn() }));

import { GET } from "./route";
import { getPacificaMarkCandles } from "@/server/providers/pacifica/candles";

afterEach(() => vi.clearAllMocks());

describe("Pacifica candles API", () => {
  it("returns an empty actual series when the selected market has no candle history", async () => {
    vi.mocked(getPacificaMarkCandles).mockResolvedValue([]);
    const response = await GET(new Request("https://app.test/api/pacifica/candles?symbol=BTC&period=1D"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ symbol: "BTC", period: "1D", interval: "1m", candles: [], source: "pacifica-testnet" });
  });

  it("returns unavailable on provider failure without a mock series", async () => {
    vi.mocked(getPacificaMarkCandles).mockRejectedValue(new Error("upstream failed"));
    const response = await GET(new Request("https://app.test/api/pacifica/candles?symbol=BTC&period=ALL"));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ message: expect.any(String) });
  });
});
