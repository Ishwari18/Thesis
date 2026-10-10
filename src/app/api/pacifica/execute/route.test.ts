import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  userRpc: vi.fn(),
  adminRpc: vi.fn(),
  adminAvailable: true,
  intent: { batch_id: "33333333-3333-4333-8333-333333333333", existing: false, status: "pending" },
  leverage: vi.fn(),
  submit: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: mocks.getUser }, from: (table: string) => {
    const data = table === "thesis_allocations"
      ? { id: "11111111-1111-4111-8111-111111111111", user_id: "22222222-2222-4222-8222-222222222222", thesis_id: "44444444-4444-4444-8444-444444444444", collateral: "100", leverage: 3, status: "pending" }
      : table === "allocation_legs"
        ? [{ id: "55555555-5555-4555-8555-555555555555", market_id: "66666666-6666-4666-8666-666666666666", direction: "long", entry_weight: "1" }]
        : [{ id: "66666666-6666-4666-8666-666666666666", symbol: "SOL" }];
    const promise = Promise.resolve({ data, error: null });
    const builder = { select: () => builder, eq: () => builder, in: () => builder, maybeSingle: () => promise, then: promise.then.bind(promise) };
    return builder;
  }, rpc: mocks.userRpc }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => {
  if (!mocks.adminAvailable) throw new Error("missing service role key");
  return { rpc: mocks.adminRpc };
} }));
vi.mock("@/server/services/allocation", () => ({ previewAllocation: () => ({ valid: true, legs: [{ symbol: "SOL", direction: "long", quantity: "1" }] }) }));
vi.mock("@/server/providers/pacifica/market-data", () => ({ fetchPacificaSnapshot: async () => ({ markets: [], quotes: [] }) }));
vi.mock("@/server/providers/pacifica/config", () => ({
  readPacificaConfig: () => ({}),
  requireExecutionConfig: () => ({ privateKey: "test", accountAddress: "test", allowedUserId: "22222222-2222-4222-8222-222222222222" }),
}));
vi.mock("@/server/providers/pacifica/signing", () => ({ loadPacificaSigningIdentity: vi.fn() }));
vi.mock("@/server/providers/pacifica/leverage", () => ({ setPacificaLeverage: mocks.leverage }));
vi.mock("@/server/providers/pacifica/orders", () => ({ submitPacificaMarketBatch: mocks.submit }));
vi.mock("@/server/providers/pacifica/errors", () => ({ safePacificaMessage: () => "Safe provider error." }));

import { POST } from "./route";
const userId = "22222222-2222-4222-8222-222222222222";
const allocationId = "11111111-1111-4111-8111-111111111111";
const idempotencyKey = "77777777-7777-4777-8777-777777777777";
const request = () => new Request("http://localhost/api/pacifica/execute", { method: "POST", body: JSON.stringify({ allocationId, idempotencyKey }) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.adminAvailable = true;
  mocks.intent = { batch_id: "33333333-3333-4333-8333-333333333333", existing: false, status: "pending" };
  mocks.getUser.mockResolvedValue({ data: { user: { id: userId } } });
  mocks.userRpc.mockResolvedValue({ data: mocks.intent, error: null });
  mocks.adminRpc.mockResolvedValue({ data: null, error: null });
  mocks.leverage.mockResolvedValue(undefined);
  mocks.submit.mockResolvedValue([{ status: "accepted", externalId: "order-1" }]);
});

describe("Pacifica execute route trust boundary", () => {
  it("creates the intent with the user client and records outcomes only with the privileged server client", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.userRpc).toHaveBeenCalledWith("create_pacifica_execution_intent", expect.objectContaining({ p_allocation_id: allocationId }));
    expect(mocks.userRpc).toHaveBeenCalledTimes(1);
    expect(mocks.adminRpc).toHaveBeenCalledWith("record_pacifica_execution_results", expect.objectContaining({
      p_batch_id: "33333333-3333-4333-8333-333333333333", p_user_id: userId, p_status: "submitted",
      p_results: [{ client_order_id: expect.any(String), status: "submitted", external_id: "order-1" }],
    }));
    expect(mocks.submit).toHaveBeenCalledOnce();
  });

  it("returns an existing idempotent batch without resubmitting any order", async () => {
    mocks.intent = { batch_id: "33333333-3333-4333-8333-333333333333", existing: true, status: "pending" };
    mocks.userRpc.mockResolvedValue({ data: mocks.intent, error: null });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });

  it("records an unknown provider outcome and never resubmits it", async () => {
    mocks.submit.mockRejectedValue(new Error("transport timeout"));
    const response = await POST(request());
    const body = await response.json();
    expect(response.status).toBe(202);
    expect(body).toMatchObject({ status: "submission_unknown", filled: false, reconciliationRequired: false });
    expect(mocks.adminRpc).toHaveBeenCalledWith("record_pacifica_execution_results", expect.objectContaining({ p_status: "submission_unknown", p_results: [] }));
    expect(mocks.submit).toHaveBeenCalledOnce();
  });

  it("fails closed before creating an intent when privileged result storage is missing", async () => {
    mocks.adminAvailable = false;
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(mocks.userRpc).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("does not allow another authenticated user to reach the intent RPC", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "99999999-9999-4999-8999-999999999999" } } });
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(mocks.userRpc).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
  });
});
