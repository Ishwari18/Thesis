import { NextResponse } from "next/server";
import { z } from "zod";
import { getAppUser, adminClient } from "@/lib/auth/server";
import { readPacificaConfig, requireExecutionConfig } from "@/server/providers/pacifica/config";
import { getPacificaPositions } from "@/server/providers/pacifica/positions";
import { submitPacificaMarketBatch } from "@/server/providers/pacifica/orders";
import { safePacificaMessage } from "@/server/providers/pacifica/errors";
import { reconcileAllocation } from "@/server/services/trading/reconcile";

export const dynamic = "force-dynamic";

const inputSchema = z.object({ allocationId: z.string().uuid(), idempotencyKey: z.string().uuid() });
type Db = {
  from(table: string): any;
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: any; error: { message?: string } | null }>;
};

export async function POST(request: Request) {
  const appUser = await getAppUser();
  if (!appUser) return NextResponse.json({ error: "Sign in to close a thesis position." }, { status: 401 });
  let config;
  try { config = requireExecutionConfig(readPacificaConfig()); }
  catch (error) { return NextResponse.json({ error: safePacificaMessage(error) }, { status: 503 }); }
  if (appUser.userId !== config.allowedUserId) return NextResponse.json({ error: "This account is not authorized to trade with the configured Pacifica testnet wallet." }, { status: 403 });
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Provide an allocation ID and UUID idempotency key." }, { status: 400 });

  const { allocationId, idempotencyKey } = parsed.data;
  const db = adminClient() as unknown as Db;
  let locked = false;
  try {
    const lock = await db.rpc("acquire_pacifica_trade_lock_for_user", { p_user_id: appUser.userId, p_lock_key: idempotencyKey });
    if (lock.error) return NextResponse.json({ error: "Trading is not ready. Apply the trade lifecycle migration before closing positions." }, { status: 503 });
    if (lock.data !== true) return NextResponse.json({ error: "Another trade is being processed for this account. Wait for it to finish, then retry with the same request." }, { status: 409 });
    locked = true;

    const allocation = await db.from("thesis_allocations")
      .select("id,status,side")
      .eq("id", allocationId)
      .eq("user_id", appUser.userId)
      .maybeSingle();
    if (allocation.error || !allocation.data) return NextResponse.json({ error: "Thesis allocation not found." }, { status: 404 });
    if (allocation.data.status !== "open") return NextResponse.json({ error: "Only a confirmed open thesis allocation can be closed." }, { status: 409 });

    const replay = await db.from("pacifica_execution_batches")
      .select("id,status")
      .eq("allocation_id", allocationId)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (replay.data) {
      const reconciled = await reconcileAllocation(appUser.userId, allocationId).catch(() => null);
      return NextResponse.json({ allocationId, batchId: replay.data.id, status: replay.data.status, idempotentReplay: true, fills: reconciled?.confirmed ?? [], unresolvedClientOrderIds: reconciled?.unresolvedClientOrderIds ?? [] });
    }

    const legResult = await db.from("allocation_legs")
      .select("id,market_id,direction,filled_quantity")
      .eq("allocation_id", allocationId);
    if (legResult.error || !legResult.data?.length) return NextResponse.json({ error: "The allocation legs could not be loaded." }, { status: 503 });
    const legIds = legResult.data.map((row: { id: string }) => row.id);
    const executionResult = await db.from("executions")
      .select("allocation_leg_id,kind,status,filled_quantity")
      .in("allocation_leg_id", legIds);
    if (executionResult.error) return NextResponse.json({ error: "The allocation execution history could not be loaded." }, { status: 503 });
    const unresolved = (executionResult.data ?? []).find((row: { status: string }) => ["pending", "submitted", "partially_filled", "submission_unknown"].includes(row.status));
    if (unresolved) return NextResponse.json({ error: "This thesis has an order whose final result is not confirmed. Reconcile it before closing; THESIS will not guess the remaining size." }, { status: 409 });

    const closeByLeg = new Map<string, number>();
    for (const execution of executionResult.data ?? []) {
      if (execution.kind === "close") closeByLeg.set(execution.allocation_leg_id, (closeByLeg.get(execution.allocation_leg_id) ?? 0) + Number(execution.filled_quantity));
    }
    const remaining = legResult.data.map((leg: { id: string; market_id: string; direction: "long" | "short"; filled_quantity: string }) => ({
      ...leg,
      remaining: Math.max(0, Number(leg.filled_quantity) - (closeByLeg.get(leg.id) ?? 0)),
    })).filter((leg: { filled_quantity: string; remaining: number }) => Number(leg.filled_quantity) > 0 && leg.remaining > 0);
    if (!remaining.length) return NextResponse.json({ error: "There is no remaining confirmed thesis quantity to close." }, { status: 409 });

    const marketRows = await db.from("markets").select("id,symbol").in("id", [...new Set(remaining.map((row: { market_id: string }) => row.market_id))]);
    if (marketRows.error) return NextResponse.json({ error: "The thesis market catalogue could not be loaded." }, { status: 503 });
    const symbolByMarket = new Map((marketRows.data ?? []).map((row: { id: string; symbol: string }) => [row.id, row.symbol]));
    const positions = await getPacificaPositions();
    for (const leg of remaining) {
      const symbol = symbolByMarket.get(leg.market_id) as string | undefined;
      if (!symbol) return NextResponse.json({ error: "A thesis market is missing; no close order was sent." }, { status: 503 });
      const position = positions.find((row) => row.symbol === symbol);
      if (!position) return NextResponse.json({ error: `${symbol} has no matching Pacifica position. It may have been closed outside this thesis; no order was sent.` }, { status: 409 });
      if (position.direction !== leg.direction) return NextResponse.json({ error: `${symbol} is currently ${position.direction}, but this thesis leg is ${leg.direction}. No close order was sent.` }, { status: 409 });
      if (Number(position.quantity) < leg.remaining) return NextResponse.json({ error: `${symbol} exchange quantity (${position.quantity}) is smaller than this thesis's remaining quantity (${leg.remaining}). Reconcile the shared position before closing.` }, { status: 409 });
    }

    const intent = await db.rpc("create_pacifica_close_intent_for_user", { p_user_id: appUser.userId, p_allocation_id: allocationId, p_idempotency_key: idempotencyKey });
    if (intent.error || !intent.data?.batch_id || !Array.isArray(intent.data.legs)) {
      return NextResponse.json({ error: intent.error?.message?.includes("unresolved") ? "Reconcile every thesis order before closing." : "THESIS could not persist the close intent. No Pacifica order was sent." }, { status: 409 });
    }
    const batchId = String(intent.data.batch_id);
    if (intent.data.existing) {
      return NextResponse.json({ allocationId, batchId, status: intent.data.status, idempotentReplay: true, orders: intent.data.legs });
    }
    const orders = intent.data.legs as Array<{ symbol: string; side: "bid" | "ask"; quantity: string; clientOrderId: string }>;
    try {
      const providerResults = await submitPacificaMarketBatch(orders.map((order) => ({
        symbol: order.symbol,
        side: order.side,
        quantity: order.quantity,
        clientOrderId: order.clientOrderId,
        slippagePercent: "1",
        reduceOnly: true,
      })));
      const accepted = providerResults.filter((row) => row.status === "accepted").length;
      const status = accepted === providerResults.length ? "submitted" : accepted === 0 ? "rejected" : "partial";
      const recorded = await db.rpc("record_pacifica_execution_results", {
        p_batch_id: batchId,
        p_user_id: appUser.userId,
        p_status: status,
        p_provider_error: accepted === providerResults.length ? null : "One or more reduce-only close actions were rejected. The remaining quantity is still open.",
        p_results: providerResults.map((row, index) => ({ client_order_id: orders[index].clientOrderId, status: row.status === "accepted" ? "submitted" : "rejected", external_id: row.externalId ?? null })),
      });
      const reconciled = recorded.error ? null : await reconcileAllocation(appUser.userId, allocationId).catch(() => null);
      const fills = new Map((reconciled?.confirmed ?? []).map((row) => [row.clientOrderId, row]));
      return NextResponse.json({
        allocationId,
        batchId,
        status,
        ...(recorded.error ? { reconciliationRequired: true, error: "Pacifica returned per-order results, but THESIS could not save them. Do not retry this batch." } : {}),
        orders: orders.map((order, index) => ({
          symbol: order.symbol,
          side: order.side,
          quantity: order.quantity,
          reduceOnly: true,
          status: providerResults[index].status === "rejected" ? "rejected" : fills.has(order.clientOrderId) ? "filled" : "accepted_unconfirmed",
          fillPrice: fills.get(order.clientOrderId)?.averageFillPrice ?? null,
        })),
        unresolvedClientOrderIds: reconciled?.unresolvedClientOrderIds ?? orders.filter((order, index) => providerResults[index].status === "accepted" && !fills.has(order.clientOrderId)).map((order) => order.clientOrderId),
      }, { status: recorded.error ? 202 : 200 });
    } catch (error) {
      const message = safePacificaMessage(error);
      await db.rpc("record_pacifica_execution_results", {
        p_batch_id: batchId,
        p_user_id: appUser.userId,
        p_status: "submission_unknown",
        p_provider_error: message,
        p_results: [],
      });
      return NextResponse.json({ allocationId, batchId, status: "submission_unknown", reconciliationRequired: true, error: "Pacifica close outcome is unknown. Do not retry; reconcile this thesis before taking another action." }, { status: 202 });
    }
  } catch (error) {
    return NextResponse.json({ error: safePacificaMessage(error) }, { status: 503 });
  } finally {
    if (locked) await db.rpc("release_pacifica_trade_lock_for_user", { p_user_id: appUser.userId, p_lock_key: idempotencyKey }).catch(() => undefined);
  }
}
