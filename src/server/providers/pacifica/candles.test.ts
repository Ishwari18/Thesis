import { beforeEach, describe, expect, it, vi } from "vitest";
import { getPacificaMarkCandles } from "./candles";
import type { PacificaClient } from "./client";

describe("Pacifica mark candles", () => {
  let client: PacificaClient;
  beforeEach(() => {
    client = { get: vi.fn(), post: vi.fn() };
  });

  it("normalizes actual closes and removes duplicate timestamps", async () => {
    vi.mocked(client.get).mockResolvedValue({ success: true, data: [
      { t: 2, c: "20" }, { t: 1, c: "10" }, { t: 2, c: "21" },
    ]});
    await expect(getPacificaMarkCandles({ symbol: "BTC", interval: "1m", startTime: 0, client }))
      .resolves.toEqual([{ timestamp: 1, value: 10 }, { timestamp: 2, value: 21 }]);
    expect(client.get).toHaveBeenCalledWith("/api/v1/kline/mark", expect.objectContaining({ symbol: "BTC", interval: "1m", start_time: "0" }));
  });

  it("returns an empty series when Pacifica has no history", async () => {
    vi.mocked(client.get).mockResolvedValue({ success: true, data: [] });
    await expect(getPacificaMarkCandles({ symbol: "BTC", interval: "1d", startTime: 0, client })).resolves.toEqual([]);
  });

  it("rejects an invalid candle API response instead of supplying fallback points", async () => {
    vi.mocked(client.get).mockResolvedValue({ success: false, data: [] });
    await expect(getPacificaMarkCandles({ symbol: "BTC", interval: "1d", startTime: 0, client }))
      .rejects.toThrow(/candle response was invalid/i);
  });
});
