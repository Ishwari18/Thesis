import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAppUser: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
  side: "long",
  positions: [] as Array<{ symbol: string; direction: "long" | "short"; quantity: string }>,
  availableBalance: "1000",
  leverageSettings: new Map<string, number>(),
  setLeverage: vi.fn(),
  submit: vi.fn(),
  thesis: { slug: "one-market", name: "One Market", assets: [{ symbol: "NVDA", weight: "1", direction: "long", active: true, maxLeverage: 5, minNotional: "10" }] },
  existing: false,
  existingBatch: null as null | { id: string; status: string },
  reconcile: vi.fn(),
}));

vi.mock("@/lib/auth/server", () => ({ getAppUser: mocks.getAppUser, adminClient: () => ({ rpc: mocks.rpc, from: mocks.from }) }));
vi.mock("@/server/services/theses/service", () => ({ getThesisBySlug: async () => mocks.thesis }));
vi.mock("@/server/providers/pacifica/market-data", () => ({ fetchPacificaSnapshot: async () => {
  const observedAt = new Date().toISOString();
  return {
    markets: mocks.thesis.assets.map((asset) => ({ symbol: asset.symbol, active: true, minNotional: "10", lotSize: "0.01", maxLeverage: 3, observedAt })),
    quotes: mocks.thesis.assets.map((asset) => ({ symbol: asset.symbol, markPrice: "100", fresh: true, observedAt })),
  };
} }));
vi.mock("@/server/providers/pacifica/config", () => ({
  readPacificaConfig: () => ({ allowedUserId: "22222222-2222-4222-8222-222222222222" }),
  requireExecutionConfig: () => ({ allowedUserId: "22222222-2222-4222-8222-222222222222" }),
}));
vi.mock("@/server/providers/pacifica/errors", () => ({ safePacificaMessage: (error: unknown) => error instanceof Error ? error.message : "Safe provider error." }));
vi.mock("@/server/providers/pacifica/account", () => ({ getPacificaAccount: vi.fn(async () => ({ availableBalance: mocks.availableBalance, marginUsed: "0" })) }));
vi.mock("@/server/providers/pacifica/positions", () => ({ getPacificaPositions: vi.fn(async () => mocks.positions) }));
vi.mock("@/server/providers/pacifica/account-settings", () => ({ getPacificaLeverageSettings: vi.fn(async () => mocks.leverageSettings) }));
vi.mock("@/server/providers/pacifica/leverage", () => ({ setPacificaLeverage: mocks.setLeverage }));
vi.mock("@/server/providers/pacifica/orders", () => ({ submitPacificaMarketBatch: mocks.submit }));
vi.mock("@/server/services/trading/reconcile", () => ({ reconcileAllocation: mocks.reconcile }));

import { POST } from "./route";

const userId = "22222222-2222-4222-8222-222222222222";
const allocationId = "11111111-1111-4111-8111-111111111111";
const batchId = "33333333-3333-4333-8333-333333333333";
const key = "77777777-7777-4777-8777-777777777777";
const marketId = "66666666-6666-4666-8666-666666666666";
const request = (body: Record<string, unknown> = { thesisSlug: "one-market", collateral: "100", leverage: 3, side: "long", idempotencyKey: key }) => new Request("http://localhost/api/trade/open", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.side = "long";
  mocks.positions = [];
  mocks.availableBalance = "1000";
  mocks.leverageSettings = new Map();
  mocks.thesis = { slug: "one-market", name: "One Market", assets: [{ symbol: "NVDA", weight: "1", direction: "long", active: true, maxLeverage: 5, minNotional: "10" }] };
  mocks.existing = false;
  mocks.existingBatch = null;
  mocks.getAppUser.mockResolvedValue({ privyId: "privy-user", userId });
  mocks.setLeverage.mockResolvedValue({ status: "accepted" });
  mocks.submit.mockResolvedValue([{ status: "accepted", externalId: "venue-1" }]);
  mocks.reconcile.mockResolvedValue({ allocationId, confirmed: [], unresolvedClientOrderIds: ["00000000-0000-4000-8000-000000000000"], hasMoreHistory: false });
  mocks.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
    if (name === "acquire_pacifica_trade_lock_for_user") return { data: true, error: null };
    if (name === "create_thesis_allocation_for_user") {
      mocks.side = String(args.p_side);
      return { data: { allocation_id: allocationId, status: "pending", existing: mocks.existing }, error: null };
    }
    if (name === "create_pacifica_execution_intent_for_user") return { data: { batch_id: batchId, existing: false, status: "pending" }, error: null };
    if (name === "mark_thesis_allocation_open_for_user") return { data: true, error: null };
    if (name === "cancel_unsubmitted_thesis_allocation_for_user") return { data: true, error: null };
    return { data: null, error: null };
  });
  mocks.from.mockImplementation((table: string) => {
    const query: any = {
      select: () => query,
      eq: () => query,
      in: () => query,
      maybeSingle: async () => ({ data: table === "pacifica_execution_batches" ? mocks.existingBatch : null, error: null }),
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
        const rows = mocks.thesis.assets.map((asset, index) => ({
          id: `55555555-5555-4555-8555-55555555555${index}`,
          market_id: `66666666-6666-4666-8666-66666666666${index}`,
          symbol: asset.symbol,
          direction: mocks.side === "short" ? asset.direction === "long" ? "short" : "long" : asset.direction,
          entry_weight: asset.weight,
        }));
        const data = table === "allocation_legs"
          ? rows.map(({ id, market_id, direction, entry_weight }) => ({ id, market_id, direction, entry_weight }))
          : table === "markets" ? rows.map(({ market_id, symbol }) => ({ id: market_id, symbol })) : [];
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      },
    };
    return query;
  });
});

describe("one-request thesis open route", () => {
  it("opens a long as bid and persists the intent before submitting one market batch", async () => {
    const sequence: string[] = [];
    mocks.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      if (name === "acquire_pacifica_trade_lock_for_user") return { data: true, error: null };
      if (name === "create_thesis_allocation_for_user") { sequence.push("allocation"); return { data: { allocation_id: allocationId, status: "pending", existing: false }, error: null }; }
      if (name === "create_pacifica_execution_intent_for_user") { sequence.push("intent"); expect(args.p_legs).toEqual([expect.objectContaining({ side: "bid" })]); return { data: { batch_id: batchId, existing: false, status: "pending" }, error: null }; }
      if (name === "record_pacifica_execution_results") sequence.push("results");
      if (name === "mark_thesis_allocation_open_for_user") return { data: true, error: null };
      return { data: null, error: null };
    });
    mocks.submit.mockImplementation(async (orders: Array<{ side: string; reduceOnly: boolean }>) => { sequence.push("submit"); expect(orders[0]).toMatchObject({ side: "bid", reduceOnly: false }); return [{ status: "accepted", externalId: "venue-1" }]; });

    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(sequence).toEqual(["allocation", "intent", "submit", "results"]);
    expect(mocks.rpc).toHaveBeenCalledWith("create_thesis_allocation_for_user", expect.objectContaining({ p_user_id: userId, p_side: "long", p_idempotency_key: key }));
    expect(mocks.submit).toHaveBeenCalledOnce();
  });

  it("flips every thesis leg for a short and submits ask orders", async () => {
    const response = await POST(request({ thesisSlug: "one-market", collateral: "100", leverage: 2, side: "short", idempotencyKey: key }));
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("create_thesis_allocation_for_user", expect.objectContaining({ p_side: "short" }));
    expect(mocks.submit).toHaveBeenCalledWith([expect.objectContaining({ side: "ask" })]);
  });

  it("rejects collateral below the live market minimum before creating an allocation", async () => {
    const response = await POST(request({ thesisSlug: "one-market", collateral: "1", leverage: 2, side: "long", idempotencyKey: key }));
    expect(response.status).toBe(422);
    expect(mocks.rpc).not.toHaveBeenCalledWith("create_thesis_allocation_for_user", expect.anything());
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("blocks leverage above the lowest live market cap", async () => {
    const response = await POST(request({ thesisSlug: "one-market", collateral: "100", leverage: 5, side: "long", idempotencyKey: key }));
    expect(response.status).toBe(422);
    expect(mocks.rpc).not.toHaveBeenCalledWith("create_thesis_allocation_for_user", expect.anything());
  });

  it("blocks insufficient free balance before allocation creation", async () => {
    mocks.availableBalance = "50";
    const response = await POST(request());
    expect(response.status).toBe(422);
    expect(mocks.rpc).not.toHaveBeenCalledWith("create_thesis_allocation_for_user", expect.anything());
  });

  it("blocks an opposite-side exchange position", async () => {
    mocks.positions = [{ symbol: "NVDA", direction: "short", quantity: "1" }];
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("opposite short position in NVDA");
    expect(mocks.rpc).not.toHaveBeenCalledWith("create_thesis_allocation_for_user", expect.anything());
  });

  it("cancels a saved allocation when leverage fails before order submission", async () => {
    mocks.setLeverage.mockRejectedValue(new Error("NVDA leverage update failed"));
    const response = await POST(request());
    expect(response.status).toBe(422);
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith("cancel_unsubmitted_thesis_allocation_for_user", { p_allocation_id: allocationId, p_user_id: userId });
  });

  it("keeps partial successes open and records a rejected leg", async () => {
    mocks.thesis = { slug: "two-markets", name: "Two Markets", assets: [
      { symbol: "NVDA", weight: "0.5", direction: "long", active: true, maxLeverage: 5, minNotional: "10" },
      { symbol: "AMD", weight: "0.5", direction: "long", active: true, maxLeverage: 5, minNotional: "10" },
    ] };
    mocks.submit.mockResolvedValue([{ status: "accepted", externalId: "one" }, { status: "rejected" }]);
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect((await response.json()).status).toBe("partial");
    expect(mocks.rpc).toHaveBeenCalledWith("mark_thesis_allocation_open_for_user", { p_allocation_id: allocationId, p_user_id: userId });
  });

  it("records an unknown outcome and never resubmits an idempotent replay", async () => {
    mocks.submit.mockRejectedValueOnce(new Error("timeout"));
    const first = await POST(request());
    expect(first.status).toBe(202);
    expect((await first.json()).status).toBe("submission_unknown");
    expect(mocks.submit).toHaveBeenCalledOnce();

    mocks.existing = true;
    mocks.existingBatch = { id: batchId, status: "submission_unknown" };
    const second = await POST(request());
    expect(second.status).toBe(200);
    expect((await second.json()).idempotentReplay).toBe(true);
    expect(mocks.submit).toHaveBeenCalledOnce();
  });

  it("returns 401 and 403 without touching the database or exchange", async () => {
    mocks.getAppUser.mockResolvedValueOnce(null);
    expect((await POST(request())).status).toBe(401);
    mocks.getAppUser.mockResolvedValueOnce({ privyId: "other", userId: "99999999-9999-4999-8999-999999999999" });
    expect((await POST(request())).status).toBe(403);
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
