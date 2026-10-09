import { describe, expect, it } from "vitest";
import { safeAuthRedirectPath } from "./redirect";

describe("safe auth callback redirect", () => {
  it("preserves safe same-site paths and query values", () => {
    expect(safeAuthRedirectPath("/discover?from=confirmation")).toBe("/discover?from=confirmation");
  });
  it.each(["https://attacker.example", "//attacker.example", "\\\\attacker.example", "", null])("falls back for unsafe redirect %s", value => {
    expect(safeAuthRedirectPath(value)).toBe("/discover");
  });
});
