import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAppUser: vi.fn(),
  adminRpc: vi.fn(),
}));

vi.mock("@/lib/auth/server", () => ({
  getAppUser: mocks.getAppUser,
  adminClient: () => ({ rpc: mocks.adminRpc }),
}));

import { POST } from "./route";
const body = { thesisSlug: "ai-infrastructure", collateral: "100.00", leverage: 3 };
const makeRequest = (input: unknown = body) => new Request("http://localhost/api/allocations", { method: "POST", body: JSON.stringify(input) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAppUser.mockResolvedValue({ privyId: "privy-user", userId: "22222222-2222-4222-8222-222222222222" });
});

describe("retired save-only allocations route", () => {
  it("requires a verified Privy app user", async () => {
    mocks.getAppUser.mockResolvedValue(null);
    const response = await POST(makeRequest());
    expect(response.status).toBe(401);
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });

  it("validates leverage and amount before returning the retired-route response", async () => {
    const response = await POST(makeRequest({ ...body, leverage: 4 }));
    expect(response.status).toBe(400);
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });

  it("does not create an allocation without the matching execution request", async () => {
    const response = await POST(makeRequest());
    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("/api/trade/open") });
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });

  it("does not expose database detail or create an allocation for malformed input", async () => {
    const response = await POST(new Request("http://localhost/api/allocations", { method: "POST", body: "{" }));
    expect(response.status).toBe(400);
    expect(await response.json()).not.toHaveProperty("internal database detail");
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });
});
