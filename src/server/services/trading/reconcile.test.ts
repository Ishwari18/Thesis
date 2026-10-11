import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), history: vi.fn(), executionRows: [] as any[] }));
vi.mock("@/lib/auth/server", () => ({ adminClient: () => ({ rpc: mocks.rpc, from: mocks.from }) }));
vi.mock("@/server/providers/pacifica/trade-history", () => ({ getPacificaTradeHistory: mocks.history }));

import { reconcileAllocation } from "./reconcile";

const userId = "22222222-2222-4222-8222-222222222222";
const allocationId = "11111111-1111-4111-8111-111111111111";
const batchId = "33333333-3333-4333-8333-333333333333";
const legId = "55555555-5555-4555-8555-555555555555";
const firstId = "88888888-8888-4888-8888-888888888888";
const unknownId = "99999999-9999-4999-8999-999999999999";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.executionRows = [
    { id: "a", allocation_leg_id: legId, batch_id: batchId, client_order_id: firstId, requested_quantity: "1", filled_quantity: "0", fee: "0", status: "submitted", created_at: "2026-10-11T00:00:00.000Z" },
    { id: "b", allocation_leg_id: legId, batch_id: batchId, client_order_id: unknownId, requested_quantity: "2", filled_quantity: "0", fee: "0", status: "submission_unknown", created_at: "2026-10-11T00:00:00.000Z" },
  ];
  mocks.history.mockResolvedValue({ trades: [
    { client_order_id: firstId, symbol: "NVDA", amount: "0.4", price: "100", fee: "0.04", event_type: "fulfill_taker", side: "open_long" },
    { client_order_id: firstId, symbol: "NVDA", amount: "0.6", price: "110", fee: "0.06", event_type: "fulfill_taker", side: "open_long" },
    { client_order_id: unknownId, symbol: "NVDA", amount: "1", price: "100", fee: "0.1", event_type: "fulfill_taker", side: "close_long" },
  ], hasMore: false });
  mocks.rpc.mockResolvedValue({ data: null, error: null });
  mocks.from.mockImplementation((table: string) => {
    const query: any = {
      select: () => query,
      eq: () => query,
      in: () => query,
      maybeSingle: async () => ({ data: table === "thesis_allocations" ? { id: allocationId, status: "open" } : null, error: null }),
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
        const data = table === "allocation_legs" ? [{ id: legId }]
          : table === "executions" ? mocks.executionRows
            : table === "pacifica_execution_batches" ? [{ id: batchId, kind: "open", created_at: "2026-10-11T00:00:00.000Z" }] : [];
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      },
    };
    return query;
  });
});

describe("trade fill reconciliation", () => {
  it("aggregates trade-history rows by exact client order ID and records VWAP and fees", async () => {
    const result = await reconcileAllocation(userId, allocationId);
    expect(mocks.rpc).toHaveBeenCalledWith("confirm_pacifica_execution_fills_for_user", {
      p_batch_id: batchId,
      p_user_id: userId,
      p_results: [{ client_order_id: firstId, filled_quantity: "1", average_fill_price: "106", fee: "0.1" }],
    });
    expect(result.confirmed).toEqual([{ clientOrderId: firstId, filledQuantity: "1", averageFillPrice: "106", fee: "0.1", kind: "open" }]);
    expect(result.unresolvedClientOrderIds).toEqual([unknownId]);
  });

  it("checks trade history once more when fills have not propagated yet", async () => {
    mocks.history.mockReset()
      .mockResolvedValueOnce({ trades: [], hasMore: false })
      .mockResolvedValueOnce({ trades: [
        { client_order_id: firstId, symbol: "NVDA", amount: "1", price: "105", fee: "0.1", event_type: "fulfill_taker", side: "open_long" },
      ], hasMore: false });
    const result = await reconcileAllocation(userId, allocationId);
    expect(mocks.history).toHaveBeenCalledTimes(2);
    expect(result.confirmed).toContainEqual({ clientOrderId: firstId, filledQuantity: "1", averageFillPrice: "105", fee: "0.1", kind: "open" });
  });

  it("keeps unmatched unknown outcomes unresolved and never sends another order", async () => {
    mocks.history.mockResolvedValue({ trades: [], hasMore: false });
    const result = await reconcileAllocation(userId, allocationId);
    expect(result.confirmed).toEqual([]);
    expect(result.unresolvedClientOrderIds).toEqual([firstId, unknownId]);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("does not confirm an open execution from close-side history evidence", async () => {
    mocks.history.mockResolvedValue({ trades: [{ client_order_id: firstId, symbol: "NVDA", amount: "1", price: "100", fee: "0.1", event_type: "fulfill_taker", side: "close_long" }], hasMore: false });
    const result = await reconcileAllocation(userId, allocationId);
    expect(result.confirmed).toEqual([]);
    expect(result.unresolvedClientOrderIds).toContain(firstId);
  });
});
