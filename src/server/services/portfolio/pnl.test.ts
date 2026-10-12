import { describe, expect, it } from "vitest";
import { netPnl, realizedPnl, unrealizedPnl } from "./pnl";

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

  it("keeps realized and unrealized P&L separate across multiple constituents", () => {
    const realized = realizedPnl("long", "100", "110", "1", "0.2", "0.1")
      .plus(realizedPnl("short", "100", "90", "2", "0.1", "0.2"));
    const unrealized = unrealizedPnl("1", "100", "105")
      .plus(unrealizedPnl("-1", "100", "110"));

    expect(realized.toFixed(2)).toBe("29.40");
    expect(unrealized.toFixed(2)).toBe("-5.00");
    expect(netPnl(realized.toString(), unrealized.toString(), "0", "-0.5").toFixed(2)).toBe("23.90");
  });
});
