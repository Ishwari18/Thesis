import { describe, expect, it } from "vitest";
import { realizedPnl, unrealizedPnl } from "./pnl";

describe("per-thesis P&L math", () => {
  it("books a long exit less opening and closing fees", () => {
    expect(realizedPnl("long", "100", "110", "2", "0.1", "0.2").toFixed(2)).toBe("19.70");
  });

  it("books a short exit less opening and closing fees", () => {
    expect(realizedPnl("short", "100", "90", "2", "0.1", "0.2").toFixed(2)).toBe("19.70");
  });

  it("signs unrealized short P&L from the thesis leg direction", () => {
    expect(unrealizedPnl("-2", "100", "90").toFixed(2)).toBe("20.00");
    expect(unrealizedPnl("2", "100", "90").toFixed(2)).toBe("-20.00");
  });
});
