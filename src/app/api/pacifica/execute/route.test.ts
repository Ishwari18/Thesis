import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getAppUser: vi.fn(), adminRpc: vi.fn() }));
vi.mock("@/lib/auth/server", () => ({
  getAppUser: mocks.getAppUser,
  adminClient: () => ({ rpc: mocks.adminRpc }),
}));
vi.mock("@/server/providers/pacifica/config", () => ({
  readPacificaConfig: () => ({ allowedUserId: "22222222-2222-4222-8222-222222222222" }),
}));

import { POST } from "./route";
const userId = "22222222-2222-4222-8222-222222222222";
const input = { allocationId: "11111111-1111-4111-8111-111111111111", idempotencyKey: "77777777-7777-4777-8777-777777777777" };
const request = (body: unknown = input) => new Request("http://localhost/api/pacifica/execute", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAppUser.mockResolvedValue({ privyId: "privy-user", userId });
});

describe("retired two-request Pacifica execute route", () => {
  it("requires Privy authentication", async () => {
    mocks.getAppUser.mockResolvedValue(null);
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });

  it("rejects a user outside the configured testnet allowlist", async () => {
    mocks.getAppUser.mockResolvedValue({ privyId: "another-user", userId: "99999999-9999-4999-8999-999999999999" });
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });

  it("validates allocation and idempotency IDs before doing anything", async () => {
    const response = await POST(request({ allocationId: "bad", idempotencyKey: "bad" }));
    expect(response.status).toBe(400);
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });

  it("retires the old two-call flow without creating intents or submitting duplicate orders", async () => {
    const response = await POST(request());
    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("/api/trade/open") });
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });

  it("treats malformed JSON as invalid without persisting or submitting", async () => {
    const response = await POST(new Request("http://localhost/api/pacifica/execute", { method: "POST", body: "{" }));
    expect(response.status).toBe(400);
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });
});
