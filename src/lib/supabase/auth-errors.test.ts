import { describe, expect, it } from "vitest";
import { describeAuthError } from "./auth-errors";

describe("Supabase auth error handling", () => {
  it("explains invalid credentials without distinguishing the account from the password", () => {
    const result = describeAuthError({ code: "invalid_credentials", status: 400, message: "Invalid login credentials" }, "sign-in");
    expect(result.message).toMatch(/email or password is incorrect/i);
    expect(result.diagnostic).toContain("code=invalid_credentials");
    expect(result.diagnostic).toContain("HTTP 400");
  });

  it("explains email confirmation and duplicate signup distinctly", () => {
    expect(describeAuthError({ code: "email_not_confirmed" }, "sign-in").message).toMatch(/confirm your email/i);
    expect(describeAuthError({ code: "email_exists" }, "sign-up").message).toMatch(/already exist/i);
  });

  it("handles password policy, disabled signup, and rate limits", () => {
    expect(describeAuthError({ code: "weak_password" }, "sign-up").message).toMatch(/password policy/i);
    expect(describeAuthError({ code: "email_provider_disabled" }, "sign-up").message).toMatch(/disabled/i);
    expect(describeAuthError({ code: "over_email_send_rate_limit", status: 429 }, "sign-up").message).toMatch(/wait a few minutes/i);
  });

  it("does not call every HTTP 400 an invalid password", () => {
    const result = describeAuthError({ code: "hook_timeout", status: 400, message: "email service hook failed" }, "sign-up");
    expect(result.message).toMatch(/rejected this request/i);
    expect(result.diagnostic).toContain("code=hook_timeout");
  });

  it("handles fetch/network failures", () => {
    expect(describeAuthError(new TypeError("Failed to fetch"), "sign-in").message).toMatch(/could not reach supabase/i);
  });

  it("redacts supplied credentials and bearer values from development diagnostics", () => {
    const result = describeAuthError({ code: "validation_failed", status: 400, name: "AuthApiError", message: "Rejected secret-pass and Bearer abc.def.ghi" }, "sign-in", ["secret-pass"]);
    expect(result.diagnostic).not.toContain("secret-pass");
    expect(result.diagnostic).not.toContain("abc.def.ghi");
    expect(result.diagnostic).toContain("[redacted]");
  });
});
