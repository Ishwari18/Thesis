
import "server-only";

import { adminClient } from "@/lib/auth/server";
import type { Thesis, ThesisAsset } from "@/lib/types";

const PALETTE = [
  "#9b8cff",
  "#dc8c68",
  "#74b69b",
  "#779ee4",
  "#d8b65a",
  "#be84bf",
  "#69aab8",
  "#d07e75",
];

type ThesisRow = {
  id: string;
  slug: string;
  name: string;
  category: string;
  summary: string;
  rationale: string;
  horizon: string | null;
  risk_label: string | null;
  status: string;
  created_at: string;
};

type AssetRow = {
  thesis_id: string;
  market_id: string;
  target_weight: number | string;
  direction: string;
};

type MarketRow = {
  id: string;
  symbol: string;
  active: boolean;
  min_notional: number | string | null;
  max_leverage: number | string;
  quantity_precision: number;
  metadata_at?: string | null;
};

type LoadedThesis = {
  row: ThesisRow;
  assets: Array<{
    asset: AssetRow;
    market: MarketRow | undefined;
  }>;
};

function hash(value: string): number {
  return [...value].reduce(
    (result, char) => (result * 31 + char.charCodeAt(0)) >>> 0,
    7,
  );
}

async function loadTheses(slug?: string): Promise<LoadedThesis[]> {
  const db = adminClient();

  let query = db
    .from("theses")
    .select(
      "id,slug,name,category,summary,rationale,horizon,risk_label,status,created_at",
    )
    .eq("status", "published")
    .order("created_at", { ascending: true });

  if (slug) {
    query = query.eq("slug", slug);
  }

  const { data: thesisRows, error: thesisError } = await query;

  if (thesisError) {
    throw new Error(`Failed to load theses: ${thesisError.message}`);
  }

  const rows = (thesisRows ?? []) as ThesisRow[];

  if (rows.length === 0) {
    return [];
  }

  const { data: assetRows, error: assetError } = await db
    .from("thesis_assets")
    .select("thesis_id,market_id,target_weight,direction")
    .in(
      "thesis_id",
      rows.map((row) => row.id),
    );

  if (assetError) {
    throw new Error(`Failed to load thesis assets: ${assetError.message}`);
  }

  const assets = (assetRows ?? []) as AssetRow[];
  const marketIds = [...new Set(assets.map((asset) => asset.market_id))];

  let markets: MarketRow[] = [];

  if (marketIds.length > 0) {
    const { data: marketRows, error: marketError } = await db
      .from("markets")
      .select(
        "id,symbol,active,min_notional,max_leverage,quantity_precision,metadata_at",
      )
      .in("id", marketIds);

    if (marketError) {
      throw new Error(`Failed to load markets: ${marketError.message}`);
    }

    markets = (marketRows ?? []) as MarketRow[];
  }

  const marketById = new Map(markets.map((market) => [market.id, market]));

  return rows.map((row) => ({
    row,
    assets: assets
      .filter((asset) => asset.thesis_id === row.id)
      .map((asset) => ({
        asset,
        market: marketById.get(asset.market_id),
      })),
  }));
}

function validateThesis(loaded: LoadedThesis): string[] {
  const problems: string[] = [];
  const { row, assets } = loaded;

  if (assets.length === 0) {
    problems.push("no assets");
  }

  if (assets.length > 10) {
    problems.push("more than 10 assets");
  }

  const weights = assets.map(({ asset }) => Number(asset.target_weight));

  if (weights.some((weight) => !Number.isFinite(weight) || weight <= 0)) {
    problems.push("invalid asset weight");
  }

  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

  if (assets.length > 0 && Math.abs(totalWeight - 1) > 0.000001) {
    problems.push(`weights total ${totalWeight.toFixed(6)}, not 1`);
  }

  if (
    assets.some(
      ({ asset }) =>
        asset.direction !== "long" && asset.direction !== "short",
    )
  ) {
    problems.push("invalid asset direction");
  }

  if (assets.some(({ market }) => !market)) {
    problems.push("asset references a missing market");
  }

  if (assets.some(({ market }) => market && !market.active)) {
    problems.push("contains an inactive market");
  }

  const symbols = assets.map(({ market }) => market?.symbol);

  if (new Set(symbols).size !== symbols.length) {
    problems.push("duplicate market");
  }

  if (!row.slug || !row.name) {
    problems.push("missing slug or name");
  }

  return problems;
}

// Historical returns remain simulated until real candle history is integrated.
// The UI must continue labelling these values as simulated.
function simulatedSeries(slug: string) {
  const seed = hash(slug) % 8;
  let value = 100;

  return Array.from({ length: 48 }, (_, index) => {
    value *=
      1 +
      Math.sin((index + 2) * (seed + 2) * 0.47) * 0.012 +
      (seed % 3 === 0 ? 0.003 : 0.001);

    return {
      date: `W${index + 1}`,
      value: Math.round(value * 100) / 100,
    };
  });
}

function toThesis({ row, assets }: LoadedThesis): Thesis {
  const color = PALETTE[hash(row.slug) % PALETTE.length];

  const mappedAssets: ThesisAsset[] = [...assets]
    .sort(
      (a, b) =>
        Number(b.asset.target_weight) - Number(a.asset.target_weight),
    )
    .map(({ asset, market }, index) => {
      if (!market) {
        throw new Error(
          `Cannot map missing market for thesis ${row.slug}`,
        );
      }

      return {
        symbol: market.symbol,
       // weight: Number(asset.target_weight),
       weight: String(asset.target_weight), 
       direction: asset.direction as "long" | "short",
        color: PALETTE[(hash(row.slug) + index) % PALETTE.length],
        active: market.active,
        maxLeverage: Number(market.max_leverage),
        minNotional:
          market.min_notional == null ? "" : String(market.min_notional),
        qtyPrecision: market.quantity_precision,
        metadataObservedAt: market.metadata_at ?? "",
      };
    });

  const directions = new Set(mappedAssets.map((asset) => asset.direction));
  const series = simulatedSeries(row.slug);

  return {
    slug: row.slug,
    name: row.name,
    category: row.category,
    summary: row.summary,
    idea: row.rationale,
    horizon: row.horizon ?? "Not specified",
    risk: row.risk_label ?? "Unrated",
    color,
    initials: row.name
      .split(/\s+/)
      .map((part) => part[0])
      .slice(0, 2)
      .join(""),
    published: row.created_at.slice(0, 10),
    assets: mappedAssets,
    series,
    allTime:
      Math.round(
        (series[series.length - 1].value / series[0].value - 1) * 1000,
      ) / 10,
    tracks: "Weighted basket of Pacifica perpetual markets",
    rebalancing: "No automated rebalancing",
    posture:
      directions.size > 1
        ? "Long/short basket"
        : directions.has("short")
          ? "Directional; short exposure"
          : "Directional; long exposure",
    leverageModel: "User selected, subject to live exchange limits",
    coverage: mappedAssets.map((asset) => asset.symbol).join(", "),
    mandate:
      `${row.rationale}\n\n` +
      "Target weights come from the published thesis. " +
      "Historical performance is simulated, not actual returns. " +
      "Order sizes and availability must be validated against live Pacifica data.",
  };
}

export async function listTheses(): Promise<Thesis[]> {
  const loaded = await loadTheses();
  const result: Thesis[] = [];

  for (const thesis of loaded) {
    const problems = validateThesis(thesis);

    if (problems.length > 0) {
      console.error(
        `[thesis] Hiding ${thesis.row.slug}: ${problems.join("; ")}`,
      );
      continue;
    }

    result.push(toThesis(thesis));
  }

  return result;
}

export async function getThesisBySlug(
  slug: string,
): Promise<Thesis | null> {
  const [loaded] = await loadTheses(slug);

  if (!loaded) {
    return null;
  }

  const problems = validateThesis(loaded);

  if (problems.length > 0) {
    console.error(
      `[thesis] Invalid ${slug}: ${problems.join("; ")}`,
    );
    return null;
  }

  return toThesis(loaded);
}
