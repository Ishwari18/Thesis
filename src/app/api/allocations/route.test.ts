import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: mocks.getUser }, rpc: mocks.rpc }),
}));

import { POST } from "./route";
const body = { thesisSlug: "ai-infrastructure", collateral: "100.00", leverage: 3 };
const makeRequest = (input: unknown = body) => new Request("http://localhost/api/allocations", { method: "POST", body: JSON.stringify(input) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: "22222222-2222-4222-8222-222222222222" } } });
  mocks.rpc.mockResolvedValue({ data: { allocation_id: "11111111-1111-4111-8111-111111111111", status: "pending", leg_count: 3 }, error: null });
});

describe("saved allocation route", () => {
  it("requires an authenticated user", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    const response = await POST(makeRequest());
    expect(response.status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("validates supported leverage and amount before calling the database", async () => {
    const response = await POST(makeRequest({ ...body, leverage: 4 }));
    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("creates a logical allocation through the atomic RPC without submitting orders", async () => {
    const response = await POST(makeRequest());
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ allocationId: "11111111-1111-4111-8111-111111111111", status: "pending", legCount: 3 });
    expect(mocks.rpc).toHaveBeenCalledWith("create_thesis_allocation", { p_thesis_slug: "ai-infrastructure", p_collateral: 100, p_leverage: 3 });
  });

  it("returns a safe error when the server-side thesis checks fail", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "internal database detail" } });
    const response = await POST(makeRequest());
    expect(response.status).toBe(422);
    expect(await response.json()).not.toHaveProperty("internal database detail");
  });
});
