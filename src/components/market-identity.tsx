"use client";

import Image from "next/image";
import { ImageOff } from "lucide-react";
import { useEffect, useState } from "react";
import { getLogoDevUrl, getMarketMetadata } from "@/lib/market-metadata";

export function MarketIdentity({ symbol, variant = "inline" }: {
  symbol: string;
  variant?: "inline" | "compact";
}) {
  const metadata = getMarketMetadata(symbol);
  const logoUrl = getLogoDevUrl(symbol, process.env.NEXT_PUBLIC_LOGO_DEV_TOKEN);
  const [logoState, setLogoState] = useState<"loading" | "loaded" | "unavailable">(
    logoUrl ? "loading" : "unavailable"
  );

  useEffect(() => {
    setLogoState(logoUrl ? "loading" : "unavailable");
  }, [logoUrl]);

  const fallbackTitle = metadata.logoUnavailableReason
    ?? (logoUrl ? "Logo unavailable or not yet loaded." : "Logo.dev publishable key is not configured.");

  return (
    <span
      className={`market-identity market-identity-${variant}`}
      title={logoState === "loaded"
        ? `${metadata.companyName} (${symbol}) logo loaded`
        : `${metadata.companyName} (${symbol}) · ${fallbackTitle}`}
      data-logo-state={logoState}
    >
      {logoUrl && logoState !== "unavailable" ? (
        <Image
          key={logoUrl}
          src={logoUrl}
          alt=""
          aria-hidden="true"
          width={24}
          height={24}
          unoptimized
          onLoad={() => setLogoState("loaded")}
          onError={() => setLogoState("unavailable")}
        />
      ) : (
        <span className="market-identity-fallback" aria-hidden="true">
          <ImageOff size={11} strokeWidth={1.5} />
        </span>
      )}
      <span className="market-identity-copy"><strong>{metadata.companyName}</strong><small>{symbol}</small></span>
    </span>
  );
}
