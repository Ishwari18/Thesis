export type LogoLookup =
  | { type: "ticker" | "domain" | "crypto"; value: string }
  | null;

export type MarketMetadata = {
  companyName: string;
  logoLookup: LogoLookup;
  logoUnavailableReason?: string;
};

// Display/logo identifiers are deliberately separate from Pacifica symbols.
// Trading and API requests must always continue using the original symbol.
export const MARKET_METADATA: Record<string, MarketMetadata> = {
  NVDA: { companyName: "NVIDIA", logoLookup: { type: "ticker", value: "NVDA" } },
  AMD: { companyName: "AMD", logoLookup: { type: "ticker", value: "AMD" } },
  AVGO: { companyName: "Broadcom", logoLookup: { type: "ticker", value: "AVGO" } },
  TSM: { companyName: "TSMC", logoLookup: { type: "ticker", value: "TSM" } },
  TSLA: { companyName: "Tesla", logoLookup: { type: "ticker", value: "TSLA" } },
  COIN: { companyName: "Coinbase", logoLookup: { type: "ticker", value: "COIN" } },
  ROKU: { companyName: "Roku", logoLookup: { type: "ticker", value: "ROKU" } },
  AAPL: { companyName: "Apple", logoLookup: { type: "ticker", value: "AAPL" } },
  MSFT: { companyName: "Microsoft", logoLookup: { type: "ticker", value: "MSFT" } },
  AMZN: { companyName: "Amazon", logoLookup: { type: "ticker", value: "AMZN" } },
  HOOD: { companyName: "Robinhood", logoLookup: { type: "ticker", value: "HOOD" } },
  MSTR: { companyName: "Strategy", logoLookup: { type: "ticker", value: "MSTR" } },
  MU: { companyName: "Micron Technology", logoLookup: { type: "ticker", value: "MU" } },
  GOOGL: { companyName: "Alphabet", logoLookup: { type: "ticker", value: "GOOGL" } },
  META: { companyName: "Meta", logoLookup: { type: "ticker", value: "META" } },
  SAMSUNG: { companyName: "Samsung Electronics", logoLookup: { type: "domain", value: "samsung.com" } },
  SKHYNIX: { companyName: "SK hynix", logoLookup: { type: "domain", value: "skhynix.com" } },
  SNDK: { companyName: "SanDisk", logoLookup: { type: "domain", value: "sandisk.com" } },
  OPENAI: { companyName: "OpenAI", logoLookup: { type: "domain", value: "openai.com" } },
  BTC: { companyName: "Bitcoin", logoLookup: { type: "crypto", value: "BTC" } },
  ETH: { companyName: "Ethereum", logoLookup: { type: "crypto", value: "ETH" } },
  SOL: { companyName: "Solana", logoLookup: { type: "crypto", value: "SOL" } },
  HYPE: { companyName: "Hyperliquid", logoLookup: { type: "crypto", value: "HYPE" } },
  LINK: { companyName: "Chainlink", logoLookup: { type: "crypto", value: "LINK" } },
  VVV: { companyName: "Venice Token", logoLookup: { type: "crypto", value: "VVV" } },
  DRAM: {
    companyName: "DRAM",
    logoLookup: null,
    logoUnavailableReason: "This is a thematic market symbol, not one company or branded token.",
  },
};

export const SUPPORTED_MARKET_SYMBOLS = Object.keys(MARKET_METADATA).sort();

export function getMarketMetadata(symbol: string): MarketMetadata {
  return MARKET_METADATA[symbol.toUpperCase()] ?? {
    companyName: symbol,
    logoLookup: null,
    logoUnavailableReason: "No verified company or token logo mapping exists for this Pacifica symbol.",
  };
}

export function getLogoDevUrl(symbol: string, token: string | undefined): string | null {
  // Logo.dev publishable keys use the pk_ prefix. This also prevents a secret
  // sk_ key from accidentally being embedded into client-visible image URLs.
  const publishableKey = token?.trim();
  if (!publishableKey?.startsWith("pk_")) return null;

  const { logoLookup } = getMarketMetadata(symbol);
  if (!logoLookup) return null;

  const path = logoLookup.type === "domain"
    ? logoLookup.value
    : `${logoLookup.type}/${encodeURIComponent(logoLookup.value)}`;
  const params = new URLSearchParams({
    token: publishableKey,
    size: "64",
    format: "png",
    theme: "dark",
    fallback: "404",
  });

  return `https://img.logo.dev/${path}?${params.toString()}`;
}
