import { describe, expect, it } from "vitest";
import {
  getLogoDevUrl,
  getMarketMetadata,
  MARKET_METADATA,
  SUPPORTED_MARKET_SYMBOLS,
} from "./market-metadata";

describe("Pacific market logo metadata", () => {
  it("has a mapping and real Logo.dev identifier for every supported market except the thematic DRAM index", () => {
    expect(SUPPORTED_MARKET_SYMBOLS.length).toBeGreaterThan(0);
    for (const symbol of SUPPORTED_MARKET_SYMBOLS) {
      const metadata = getMarketMetadata(symbol);
      expect(metadata.companyName).toBeTruthy();
      if (symbol === "DRAM") {
        expect(metadata.logoLookup).toBeNull();
        expect(metadata.logoUnavailableReason).toContain("thematic");
      } else {
        expect(metadata.logoLookup, symbol).not.toBeNull();
      }
    }
  });

  it("uses verified domain lookups for nonstandard Pacifica company identifiers", () => {
    expect(MARKET_METADATA.SAMSUNG.logoLookup).toEqual({ type: "domain", value: "samsung.com" });
    expect(MARKET_METADATA.SKHYNIX.logoLookup).toEqual({ type: "domain", value: "skhynix.com" });
    expect(MARKET_METADATA.SNDK.logoLookup).toEqual({ type: "domain", value: "sandisk.com" });
    expect(MARKET_METADATA.OPENAI.logoLookup).toEqual({ type: "domain", value: "openai.com" });
  });

  it("keeps Pacifica symbols separate from crypto logo identifiers", () => {
    expect(MARKET_METADATA.VVV.logoLookup).toEqual({ type: "crypto", value: "VVV" });
    expect(getLogoDevUrl("VVV", "pk_public_test")).toContain("/crypto/VVV?");
    expect(getLogoDevUrl("BTC", "pk_public_test")).toContain("/crypto/BTC?");
  });

  it("requests transparent real logos only and rejects missing or secret keys", () => {
    const url = new URL(getLogoDevUrl("NVDA", "pk_public_test")!);
    expect(url.origin).toBe("https://img.logo.dev");
    expect(url.pathname).toBe("/ticker/NVDA");
    expect(url.searchParams.get("format")).toBe("png");
    expect(url.searchParams.get("theme")).toBe("dark");
    expect(url.searchParams.get("fallback")).toBe("404");
    expect(getLogoDevUrl("NVDA", undefined)).toBeNull();
    expect(getLogoDevUrl("NVDA", "sk_secret_key")).toBeNull();
  });

  it("does not invent a lookup for an unknown Pacifica symbol", () => {
    expect(getMarketMetadata("UNKNOWN-PERP").logoLookup).toBeNull();
    expect(getLogoDevUrl("UNKNOWN-PERP", "pk_public_test")).toBeNull();
  });
});
