import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PacificaAccountPanel } from "@/components/pacifica-account-panel";

export const dynamic = "force-dynamic";
type Allocation = { id: string; thesis_id: string; collateral: string; leverage: number; status: string; created_at: string };
type Thesis = { id: string; name: string; slug: string };
type Leg = { id: string; allocation_id: string; market_id: string; direction: string; entry_weight: string; target_notional: string };
type Market = { id: string; symbol: string };
type Execution = { allocation_leg_id: string; status: string };
type Query<T> = PromiseLike<{ data: T[] | null; error: { message?: string } | null }> & {
  select: (columns: string) => Query<T>;
  eq: (column: string, value: string) => Query<T>;
  in: (column: string, values: string[]) => Query<T>;
  order: (column: string, options: { ascending: boolean }) => Query<T>;
};
type PortfolioDb = {
  from(table: "thesis_allocations"): Query<Allocation>;
  from(table: "theses"): Query<Thesis>;
  from(table: "allocation_legs"): Query<Leg>;
  from(table: "markets"): Query<Market>;
  from(table: "executions"): Query<Execution>;
};
const noRows = ["00000000-0000-4000-8000-000000000000"];

export default async function PortfolioPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return <main className="page-shell"><div className="page-heading"><div><div className="eyebrow">YOUR ACCOUNT</div><h1>Portfolio</h1><p className="subheading">Sign in to view saved thesis allocations.</p></div></div><Link className="primary-trade portfolio-link" href="/auth">Sign in</Link></main>;

  const db = supabase as unknown as PortfolioDb;
  const { data: allocationRows, error } = await db.from("thesis_allocations")
    .select("id,thesis_id,collateral,leverage,status,created_at")
    .eq("user_id", user.id).order("created_at", { ascending: false });
  if (error) return <PortfolioError />;
  const allocations = allocationRows ?? [];
  const allocationIds = allocations.map(row => row.id);
  const thesisIds = [...new Set(allocations.map(row => row.thesis_id))];
  const { data: thesisRows } = await db.from("theses").select("id,name,slug").in("id", thesisIds.length ? thesisIds : noRows);
  const { data: legRows } = await db.from("allocation_legs")
    .select("id,allocation_id,market_id,direction,entry_weight,target_notional")
    .in("allocation_id", allocationIds.length ? allocationIds : noRows);
  const legs = legRows ?? [];
  const legIds = legs.map(row => row.id);
  const marketIds = [...new Set(legs.map(row => row.market_id))];
  const { data: marketRows } = await db.from("markets").select("id,symbol").in("id", marketIds.length ? marketIds : noRows);
  const { data: executionRows } = await db.from("executions").select("allocation_leg_id,status").in("allocation_leg_id", legIds.length ? legIds : noRows);
  const theses = thesisRows ?? [];
  const markets = marketRows ?? [];
  const executions = executionRows ?? [];
  const thesisById = new Map(theses.map(row => [row.id, row]));
  const symbolByMarket = new Map(markets.map(row => [row.id, row.symbol]));
  const executionsByLeg = new Map<string, string[]>();
  for (const execution of executions) executionsByLeg.set(execution.allocation_leg_id, [...(executionsByLeg.get(execution.allocation_leg_id) ?? []), execution.status]);

  return <main className="page-shell portfolio-page">
    <div className="page-heading"><div><div className="eyebrow">YOUR ACCOUNT</div><h1>Portfolio</h1><p className="subheading">Saved thesis allocations and their THESIS execution status.</p></div><Link className="portfolio-discover" href="/discover">Explore theses</Link></div>
    <PacificaAccountPanel />
    {!allocations.length ? <div className="empty-state portfolio-empty"><strong>No saved allocations yet</strong><span>Save a thesis allocation to see its legs and status here.</span><Link href="/discover">Discover theses</Link></div> : <div className="portfolio-list">
      {allocations.map(allocation => {
        const thesis = thesisById.get(allocation.thesis_id);
        const allocationLegs = legs.filter(leg => leg.allocation_id === allocation.id);
        const orderStatuses = allocationLegs.flatMap(leg => executionsByLeg.get(leg.id) ?? []);
        const status = orderStatuses.length ? summarizeStatus(orderStatuses) : allocation.status === "pending" ? "Saved · not submitted" : allocation.status;
        return <article className="portfolio-card" key={allocation.id}>
          <div className="portfolio-card-head"><div><div className="eyebrow">THESIS ALLOCATION</div><h2>{thesis?.name ?? "Thesis"}</h2></div><span className="portfolio-status">{status}</span></div>
          <div className="portfolio-metrics"><span>Collateral <strong>{allocation.collateral}</strong></span><span>Leverage <strong>{allocation.leverage}x</strong></span><span>Exposure <strong>{(Number(allocation.collateral) * Number(allocation.leverage)).toFixed(2)}</strong></span><span>Created <strong>{new Date(allocation.created_at).toLocaleDateString()}</strong></span></div>
          <div className="portfolio-legs">{allocationLegs.map(leg => <div className="portfolio-leg" key={leg.id}><span>{symbolByMarket.get(leg.market_id) ?? "Market"} <small>{leg.direction}</small></span><strong>{(Number(leg.entry_weight) * 100).toFixed(1)}%</strong><span>Target {leg.target_notional}</span><span>{(executionsByLeg.get(leg.id) ?? ["not submitted"]).join(", ")}</span></div>)}</div>
          <p className="portfolio-note">No exchange fill or thesis-level P&amp;L has been reconciled for this allocation. Saving it did not place orders.</p>
        </article>;
      })}
    </div>}
  </main>;
}

function summarizeStatus(statuses: string[]) {
  if (statuses.includes("submission_unknown")) return "Needs reconciliation";
  if (statuses.every(status => status === "submitted")) return "Orders submitted · fills unconfirmed";
  if (statuses.every(status => status === "rejected")) return "Rejected";
  if (statuses.some(status => status === "submitted" || status === "partially_filled" || status === "filled")) return "Partial / in progress";
  return statuses.join(", ");
}

function PortfolioError() {
  return <main className="page-shell"><div className="page-heading"><div><div className="eyebrow">YOUR ACCOUNT</div><h1>Portfolio</h1><p className="subheading">THESIS could not load your saved allocations.</p></div></div><Link href="/discover">Back to theses</Link></main>;
}
