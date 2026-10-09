import { describe, expect, it } from "vitest";
import { previewAllocation, minimumCollateral } from "./index";
import { unrealizedPnl, netPnl } from "../portfolio/pnl";
import { theses } from "../theses/demo";

describe("decimal-safe allocation preview",()=>{
  it("computes total and per-market notional for selected leverage",()=>{
    const preview=previewAllocation(theses[0],"100",3);
    expect(preview.exposure).toBe("300.00");
    expect(preview.legs.map(l=>l.targetNotional)).toEqual(["135.00","90.00","75.00"]);
    expect(preview.valid).toBe(true);
  });
  it("blocks a leg that does not meet its own metadata minimum",()=>{
    const preview=previewAllocation(theses[0],"10",2);
    expect(preview.valid).toBe(false);
    expect(preview.legs.some(l=>!l.eligible)).toBe(true);
  });
  it("calculates minimum collateral with decimal arithmetic",()=>{
    expect(minimumCollateral("10",3,"0.25")).toBe("13.34");
  });
  it("rejects an unsupported leverage value",()=>{
    expect(previewAllocation(theses[0],"100",4).valid).toBe(false);
  });
  it("blocks inactive demo market metadata",()=>{
    const thesis={...theses[0],assets:theses[0].assets.map((asset,i)=>i===0?{...asset,active:false}:asset)};
    expect(previewAllocation(thesis,"100",3).valid).toBe(false);
  });
});

describe("thesis accounting formulas",()=>{
  it("uses signed quantity for long and short unrealized P&L",()=>{
    expect(unrealizedPnl("2","100","110").toFixed(2)).toBe("20.00");
    expect(unrealizedPnl("-2","100","110").toFixed(2)).toBe("-20.00");
  });
  it("subtracts fees and adds signed funding cashflow",()=>{
    expect(netPnl("5","20","2","-1").toFixed(2)).toBe("22.00");
  });
});
