import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getAppUser: vi.fn(), adminClient: vi.fn() }));
vi.mock("@/lib/auth/server", () => mocks);

import { GET } from "./route";

describe("thesis performance authorization", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.getAppUser.mockResolvedValue(null); });

  it("requires an authenticated application user before querying thesis or account data", async () => {
    const response = await GET(new Request("http://localhost/api/theses/example/performance"), { params: Promise.resolve({ slug: "example" }) });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ status: "unauthenticated" });
    expect(mocks.adminClient).not.toHaveBeenCalled();
  });
});
