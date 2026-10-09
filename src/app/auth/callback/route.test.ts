import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";

const mocks = vi.hoisted(() => ({ exchangeCodeForSession: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: mocks }) }));

describe("email confirmation callback", () => {
  it("exchanges the one-time code and returns only to a safe same-origin path", async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({ error: null });
    const response = await GET(new NextRequest("https://thesis.test/auth/callback?code=one-time-code&next=%2Fdiscover"));
    expect(mocks.exchangeCodeForSession).toHaveBeenCalledWith("one-time-code");
    expect(response.headers.get("location")).toBe("https://thesis.test/discover");
  });
  it("supports the password-update destination after a recovery code exchange", async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({ error: null });
    const response = await GET(new NextRequest("https://thesis.test/auth/callback?code=recovery-code&next=%2Fauth%2Fupdate-password"));
    expect(response.headers.get("location")).toBe("https://thesis.test/auth/update-password");
  });
  it("falls back to the app when a redirect points off-site", async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({ error: null });
    const response = await GET(new NextRequest("https://thesis.test/auth/callback?code=one-time-code&next=https%3A%2F%2Fevil.example"));
    expect(response.headers.get("location")).toBe("https://thesis.test/discover");
  });
  it("returns a generic auth error for missing or invalid codes", async () => {
    const missing = await GET(new NextRequest("https://thesis.test/auth/callback"));
    expect(missing.headers.get("location")).toBe("https://thesis.test/auth?auth_error=confirmation");
    mocks.exchangeCodeForSession.mockResolvedValue({ error: new Error("private provider detail") });
    const invalid = await GET(new NextRequest("https://thesis.test/auth/callback?code=expired"));
    expect(invalid.headers.get("location")).toBe("https://thesis.test/auth?auth_error=confirmation");
  });
});
