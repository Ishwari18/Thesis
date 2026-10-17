import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAppUser: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
  allocationStatus: "open",
  direction: "long",
  filledQuantity: "0.5",
  executions: [] as Array<{
    allocation_leg_id: string;
    kind: string;
    status: string;
    filled_quantity: string;
  }>,
  position: { symbol: "NVDA", direction: "long", quantity: "0.8" },
  closeOrders: [] as Array<{
    legId: string;
    symbol: string;
    side: "bid" | "ask";
    quantity: string;
    clientOrderId: string;
  }>,
  submit: vi.fn(),
  reconcile: vi.fn(),
}));

vi.mock("@/lib/auth/server", () => ({
  getAppUser: mocks.getAppUser,
  adminClient: () => ({
    rpc: mocks.rpc,
    from: mocks.from,
  }),
}));

vi.mock("@/server/providers/pacifica/config", () => ({
  readPacificaConfig: () => ({
    allowedUserId: "22222222-2222-4222-8222-222222222222",
  }),
  requireExecutionConfig: () => ({
    allowedUserId: "22222222-2222-4222-8222-222222222222",
  }),
}));

vi.mock("@/server/providers/pacifica/positions", () => ({
  getPacificaPositions: async () => [mocks.position],
}));

vi.mock("@/server/providers/pacifica/orders", () => ({
  submitPacificaMarketBatch: mocks.submit,
}));

vi.mock("@/server/providers/pacifica/errors", () => ({
  safePacificaMessage: () => "Safe provider error.",
}));

vi.mock("@/server/services/trading/reconcile", () => ({
  reconcileAllocation: mocks.reconcile,
}));

import { POST } from "./route";

const userId = "22222222-2222-4222-8222-222222222222";
const allocationId = "11111111-1111-4111-8111-111111111111";
const batchId = "33333333-3333-4333-8333-333333333333";
const clientOrderId = "88888888-8888-4888-8888-888888888888";
const legId = "55555555-5555-4555-8555-555555555555";
const marketId = "66666666-6666-4666-8666-666666666666";
const key = "77777777-7777-4777-8777-777777777777";

const request = () =>
  new Request("http://localhost/api/trade/close", {
    method: "POST",
    body: JSON.stringify({
      allocationId,
      idempotencyKey: key,
    }),
  });

type MockQuery = {
  select: () => MockQuery;
  eq: () => MockQuery;
  in: () => MockQuery;
  maybeSingle: () => Promise<{ data: unknown; error: null }>;
  then: (
    resolve: (value: unknown) => unknown,
    reject: (reason: unknown) => unknown,
  ) => Promise<unknown>;
};

beforeEach(() => {
  vi.clearAllMocks();

  mocks.allocationStatus = "open";
  mocks.direction = "long";
  mocks.filledQuantity = "0.5";

  mocks.executions = [
    {
      allocation_leg_id: legId,
      kind: "open",
      status: "filled",
      filled_quantity: "0.5",
    },
  ];

  mocks.position = {
    symbol: "NVDA",
    direction: "long",
    quantity: "0.8",
  };

  mocks.closeOrders = [
    {
      legId,
      symbol: "NVDA",
      side: "ask",
      quantity: "0.5",
      clientOrderId,
    },
  ];

  mocks.getAppUser.mockResolvedValue({
    privyId: "privy-user",
    userId,
  });

  mocks.submit.mockResolvedValue([
    {
      status: "accepted",
      externalId: "close-1",
    },
  ]);

  mocks.reconcile.mockResolvedValue({
    confirmed: [],
    unresolvedClientOrderIds: [clientOrderId],
    hasMoreHistory: false,
  });

  mocks.rpc.mockImplementation(async (name: string) => {
    if (name === "acquire_pacifica_trade_lock_for_user") {
      return { data: true, error: null };
    }

    if (name === "create_pacifica_close_intent_for_user") {
      return {
        data: {
          batch_id: batchId,
          existing: false,
          status: "pending",
          legs: mocks.closeOrders,
        },
        error: null,
      };
    }

    return { data: null, error: null };
  });

  mocks.from.mockImplementation((table: string) => {
    const query: MockQuery = {
      select: () => query,
      eq: () => query,
      in: () => query,

      maybeSingle: async () => ({
        data:
          table === "thesis_allocations"
            ? {
                id: allocationId,
                status: mocks.allocationStatus,
                side: "long",
              }
            : null,
        error: null,
      }),

      then: (resolve, reject) => {
        const data =
          table === "allocation_legs"
            ? [
                {
                  id: legId,
                  market_id: marketId,
                  direction: mocks.direction,
                  filled_quantity: mocks.filledQuantity,
                },
              ]
            : table === "executions"
              ? mocks.executions
              : table === "markets"
                ? [{ id: marketId, symbol: "NVDA" }]
                : [];

        return Promise.resolve({ data, error: null }).then(resolve, reject);
      },
    };

    return query;
  });
});

describe("thesis close route", () => {
  it("sends the exact confirmed quantity as one reduce-only order on the opposite side", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);

    expect(mocks.submit).toHaveBeenCalledWith([
      expect.objectContaining({
        symbol: "NVDA",
        side: "ask",
        quantity: "0.5",
        reduceOnly: true,
      }),
    ]);

    expect(mocks.rpc).toHaveBeenCalledWith(
      "create_pacifica_close_intent_for_user",
      {
        p_user_id: userId,
        p_allocation_id: allocationId,
        p_idempotency_key: key,
      },
    );
  });

  it("blocks a close when the net exchange position is smaller than the thesis quantity", async () => {
    mocks.position = {
      symbol: "NVDA",
      direction: "long",
      quantity: "0.4",
    };

    const response = await POST(request());

    expect(response.status).toBe(409);

    expect((await response.json()).error).toContain(
      "smaller than this thesis's remaining quantity",
    );

    expect(mocks.submit).not.toHaveBeenCalled();

    expect(mocks.rpc).not.toHaveBeenCalledWith(
      "create_pacifica_close_intent_for_user",
      expect.anything(),
    );
  });

  it("closes only this thesis's exact quantity when another thesis shares the symbol", async () => {
    mocks.position = {
      symbol: "NVDA",
      direction: "long",
      quantity: "2.0",
    };

    mocks.closeOrders = [
      {
        legId,
        symbol: "NVDA",
        side: "ask",
        quantity: "0.5",
        clientOrderId,
      },
    ];

    const response = await POST(request());

    expect(response.status).toBe(200);

    expect(mocks.submit).toHaveBeenCalledWith([
      expect.objectContaining({
        quantity: "0.5",
        reduceOnly: true,
      }),
    ]);
  });

  it("uses only the remaining quantity after an earlier partial close", async () => {
    mocks.executions = [
      {
        allocation_leg_id: legId,
        kind: "open",
        status: "filled",
        filled_quantity: "0.5",
      },
      {
        allocation_leg_id: legId,
        kind: "close",
        status: "filled",
        filled_quantity: "0.2",
      },
    ];

    mocks.position = {
      symbol: "NVDA",
      direction: "long",
      quantity: "0.6",
    };

    mocks.closeOrders = [
      {
        legId,
        symbol: "NVDA",
        side: "ask",
        quantity: "0.3",
        clientOrderId,
      },
    ];

    const response = await POST(request());

    expect(response.status).toBe(200);

    expect(mocks.submit).toHaveBeenCalledWith([
      expect.objectContaining({
        quantity: "0.3",
        reduceOnly: true,
      }),
    ]);
  });

  it("blocks unresolved and unknown execution outcomes without sending another order", async () => {
    mocks.executions = [
      {
        allocation_leg_id: legId,
        kind: "open",
        status: "submission_unknown",
        filled_quantity: "0",
      },
    ];

    const response = await POST(request());

    expect(response.status).toBe(409);

    expect((await response.json()).error).toContain(
      "final result is not confirmed",
    );

    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("blocks opposite-side positions and refuses closed allocations", async () => {
    mocks.direction = "short";

    mocks.position = {
      symbol: "NVDA",
      direction: "long",
      quantity: "1",
    };

    expect((await POST(request())).status).toBe(409);

    mocks.direction = "long";
    mocks.allocationStatus = "closed";

    expect((await POST(request())).status).toBe(409);
    expect(mocks.submit).not.toHaveBeenCalled();
  });
});