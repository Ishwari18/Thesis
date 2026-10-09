import { describe, expect, it } from "vitest";
import { validateSupabasePublicConfig } from "./config";

describe("Supabase public configuration", () => {
  it("reports missing URL and key without exposing values", () => {
    expect(validateSupabasePublicConfig(undefined, "key")).toMatchObject({ ok: false, message: expect.stringContaining("URL is missing") });
    expect(validateSupabasePublicConfig("https://project.supabase.co", undefined)).toMatchObject({ ok: false, message: expect.stringContaining("key is missing") });
  });
  it("accepts a valid hosted URL and trims its trailing slash", () => {
    expect(validateSupabasePublicConfig(" https://project.supabase.co/ ", " public-key ")).toEqual({ ok: true, config: { url: "https://project.supabase.co", publishableKey: "public-key" } });
  });
  it("rejects malformed and insecure hosted URLs but allows local development", () => {
    expect(validateSupabasePublicConfig("not-a-url", "key").ok).toBe(false);
    expect(validateSupabasePublicConfig("http://project.supabase.co", "key").ok).toBe(false);
    expect(validateSupabasePublicConfig("http://localhost:54321", "key").ok).toBe(true);
  });
  it("rejects a Supabase secret key without revealing it", () => {
    expect(validateSupabasePublicConfig("https://project.supabase.co", "sb_secret_do-not-print")).toMatchObject({ ok: false, message: expect.stringMatching(/not safe for browser use/i) });
  });
});
