import Decimal from "decimal.js";
import Link from "next/link";
import { getAppUser, adminClient } from "@/lib/auth/server";
import { PacificaAccountPanel } from "@/components/pacifica-account-panel";
import { PortfolioAllocationCard, type PortfolioAllocationView } from "@/components/portfolio-allocation-card";
import { fetchPacificaSnapshot } from "@/server/providers/pacifica/market-data";

export const dynamic = "force-dynamic";

const noRows = ["00000000-0000-4000-8000-000000000000"];

export default async function PortfolioPage() {
  const appUser = await getAppUser();
  if (!appUser) return <main className="page-shell"><div className="page-heading"><div><div className="eyebrow">YOUR ACCOUNT</div><h1>Portfolio</h1><p className="subheading">Sign in to view thesis positions and confirmed trade history.</p></div></div><Link className="primary-trade portfolio-link" href="/auth">Sign in</Link></main>;

  const db = adminClient() as any;
  const { data: allocationRows, error } = await db.from("thesis_allocations")
    .select("id,thesis_id,collateral,leverage,status,side,created_at,closed_at")
    .eq("user_id", appUser.userId)
    .order("created_at", { ascending: false });
  if (error) return <PortfolioError />;
  const allocations = allocationRows ?? [];
  const allocationIds = allocations.map((row: any) => row.id as string);
  const thesisIds = [...new Set<string>(allocations.map((row: any) => row.thesis_id as string))];
  const { data: thesisRows } = await db.from("theses").select("id,name,slug").in("id", thesisIds.length ? thesisIds : noRows);
  const { data: legsResult } = await db.from("allocation_legs")
    .select("id,allocation_id,market_id,direction,entry_weight,target_notional,actual_notional,requested_quantity,filled_quantity,entry_price,realized_pnl,fees,funding")
    .in("allocation_id", allocationIds.length ? allocationIds : noRows);
  const legs = legsResult ?? [];
  const legIds = legs.map((row: any) => row.id as string);
  const marketIds = [...new Set<string>(legs.map((row: any) => row.market_id as string))];
  const { data: marketRows } = await db.from("markets").select("id,symbol").in("id", marketIds.length ? marketIds : noRows);
  const { data: executionRows } = await db.from("executions")
    .select("id,allocation_leg_id,batch_id,kind,status,filled_quantity,average_fill_price,fee,created_at")
    .in("allocation_leg_id", legIds.length ? legIds : noRows);
  const batchIds = [...new Set<string>((executionRows ?? []).map((row: any) => row.batch_id).filter(Boolean))];
  const { data: batchRows } = await db.from("pacifica_execution_batches").select("id,status,kind").in("id", batchIds.length ? batchIds : noRows);

  let quotes: Array<{ symbol: string; markPrice: string; fresh: boolean }> = [];
  try { quotes = (await fetchPacificaSnapshot()).quotes; } catch { /* Missing live marks are displayed as em dashes. */ }

  const thesisById = new Map<string, { name: string; slug: string }>((thesisRows ?? []).map((row: any) => [row.id, { name: row.name, slug: row.slug }]));
  const symbolByMarket = new Map<string, string>((marketRows ?? []).map((row: any) => [row.id, row.symbol]));
  const batches = new Map<string, { status: string; kind: string }>((batchRows ?? []).map((row: any) => [row.id, { status: row.status, kind: row.kind }]));
  const executionsByLeg = new Map<string, any[]>();
  for (const execution of executionRows ?? []) executionsByLeg.set(execution.allocation_leg_id, [...(executionsByLeg.get(execution.allocation_leg_id) ?? []), { ...execution, kind: execution.kind ?? batches.get(execution.batch_id)?.kind ?? "open" }]);

  const cards: PortfolioAllocationView[] = allocations.map((allocation: any) => {
    const thesis = thesisById.get(allocation.thesis_id);
    const cardLegs = legs.filter((leg: any) => leg.allocation_id === allocation.id);
    const orderStatuses: string[] = cardLegs.flatMap((leg: any) => (executionsByLeg.get(leg.id) ?? []).map((execution: any) => execution.status));
    const batchStatuses = (executionRows ?? []).filter((execution: any) => cardLegs.some((leg: any) => leg.id === execution.allocation_leg_id)).map((execution: any) => batches.get(execution.batch_id)?.status).filter(Boolean);
    const badges = new Set<string>();
    if (orderStatuses.some((status) => ["submitted", "pending", "partially_filled"].includes(status))) badges.add("Fills unconfirmed");
    if (orderStatuses.includes("submission_unknown") || batchStatuses.includes("submission_unknown")) badges.add("Needs reconciliation");
    if (orderStatuses.includes("partially_filled")) badges.add("Partial fill");
    if (allocation.status === "pending") badges.add("Not submitted");

    let total = new Decimal(0);
    let totalKnown = true;
    const viewLegs = cardLegs.map((leg: any) => {
      const executions = executionsByLeg.get(leg.id) ?? [];
      const closed = executions.filter((item: any) => item.kind === "close").reduce((sum: Decimal, item: any) => sum.plus(item.filled_quantity ?? "0"), new Decimal(0));
      const openFee = executions.filter((item: any) => item.kind === "open").reduce((sum: Decimal, item: any) => sum.plus(item.fee ?? "0"), new Decimal(0));
      const openQty = new Decimal(leg.filled_quantity ?? "0");
      const remaining = Decimal.max(0, openQty.minus(closed));
      const symbol = symbolByMarket.get(leg.market_id) ?? "Unknown";
      const quote = quotes.find((item) => item.symbol === symbol && item.fresh);
      const entry = leg.entry_price == null ? null : String(leg.entry_price);
      let pnl: string | null = String(leg.realized_pnl ?? "0");
      if (remaining.gt(0)) {
        if (!quote || !entry) {
          pnl = null;
          totalKnown = false;
        } else {
          const sign = leg.direction === "long" ? 1 : -1;
          const openFeeRemaining = openQty.gt(0) ? openFee.mul(remaining).div(openQty) : new Decimal(0);
          const unrealized = remaining.mul(new Decimal(quote.markPrice).minus(entry)).mul(sign).minus(openFeeRemaining);
          pnl = new Decimal(leg.realized_pnl ?? "0").plus(unrealized).toString();
        }
      }
      if (pnl === null) totalKnown = false;
      else total = total.plus(pnl);
      return {
        id: leg.id,
        symbol,
        direction: leg.direction as "long" | "short",
        targetWeight: String(leg.entry_weight),
        filledQuantity: String(leg.filled_quantity ?? "0"),
        closedQuantity: closed.toString(),
        remainingQuantity: remaining.toString(),
        entryPrice: entry,
        markPrice: remaining.gt(0) ? quote?.markPrice ?? null : null,
        pnl,
        executionStatuses: executions.map((item: any) => item.status),
      };
    });
    const pnl = totalKnown ? total.toString() : null;
    const collateral = new Decimal(allocation.collateral);
    const pnlPercent = pnl === null || collateral.lte(0) ? null : new Decimal(pnl).div(collateral).mul(100).toString();
    return {
      id: allocation.id,
      thesisName: thesis?.name ?? "Thesis",
      slug: thesis?.slug ?? "",
      side: allocation.side === "short" ? "short" : "long",
      collateral: String(allocation.collateral),
      leverage: Number(allocation.leverage),
      exposure: new Decimal(allocation.collateral).mul(allocation.leverage).toString(),
      status: allocation.status,
      createdAt: allocation.created_at,
      closedAt: allocation.closed_at ?? null,
      pnl,
      pnlPercent,
      badges: [...badges],
      legs: viewLegs,
    };
  });
  const openCards = cards.filter((card) => card.status === "open");
  const closedCards = cards.filter((card) => card.status === "closed");
  const otherCards = cards.filter((card) => !["open", "closed"].includes(card.status));

  return <main className="page-shell portfolio-page">
    <div className="page-heading"><div><div className="eyebrow">YOUR ACCOUNT</div><h1>Portfolio</h1><p className="subheading">Per-thesis fills, live marks, P&amp;L and reduce-only close controls.</p></div><Link className="portfolio-discover" href="/discover">Explore theses</Link></div>
    <PacificaAccountPanel />
    <section className="portfolio-section"><div className="portfolio-card-head"><div><div className="eyebrow">OPEN THESIS POSITIONS</div><h2>Positions</h2></div></div>
      {openCards.length ? <div className="portfolio-list">{openCards.map((card) => <PortfolioAllocationCard key={card.id} initial={card} />)}</div> : <div className="empty-state portfolio-empty"><strong>No open thesis positions</strong><span>Open a long or short from a thesis page to see confirmed fills here.</span><Link href="/discover">Discover theses</Link></div>}
    </section>
    {otherCards.length > 0 && <section className="portfolio-section"><div className="portfolio-card-head"><div><div className="eyebrow">REVIEW NEEDED</div><h2>Other allocations</h2></div></div><div className="portfolio-list">{otherCards.map((card) => <PortfolioAllocationCard key={card.id} initial={card} />)}</div></section>}
    <section className="portfolio-section"><div className="portfolio-card-head"><div><div className="eyebrow">CLOSED THESIS HISTORY</div><h2>History</h2></div></div>
      {closedCards.length ? <div className="portfolio-list">{closedCards.map((card) => <PortfolioAllocationCard key={card.id} initial={card} />)}</div> : <div className="empty-state portfolio-empty"><strong>No closed theses yet</strong><span>Closed positions and realized thesis P&amp;L will appear here.</span></div>}
    </section>
  </main>;
}

function PortfolioError() {
  return <main className="page-shell"><div className="page-heading"><div><div className="eyebrow">YOUR ACCOUNT</div><h1>Portfolio</h1><p className="subheading">THESIS could not load your allocations. Try again in a moment.</p></div></div><Link href="/discover">Back to theses</Link></main>;
}
