import Decimal from "decimal.js";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getAppUser, adminClient } from "@/lib/auth/server";
import { getThesisBySlug } from "@/server/services/theses/service";
import { previewAllocation } from "@/server/services/allocation";
import { fetchPacificaSnapshot } from "@/server/providers/pacifica/market-data";
import { readPacificaConfig, requireExecutionConfig } from "@/server/providers/pacifica/config";
import { safePacificaMessage } from "@/server/providers/pacifica/errors";
import { getPacificaAccount } from "@/server/providers/pacifica/account";
import { getPacificaPositions } from "@/server/providers/pacifica/positions";
import { getPacificaLeverageSettings } from "@/server/providers/pacifica/account-settings";
import { setPacificaLeverage } from "@/server/providers/pacifica/leverage";
import { submitPacificaMarketBatch } from "@/server/providers/pacifica/orders";
import { reconcileAllocation } from "@/server/services/trading/reconcile";

export const dynamic = "force-dynamic";

const inputSchema = z.object({
  thesisSlug: z.string().regex(/^[a-z0-9-]{1,100}$/),
  collateral: z.string().regex(/^\d+(\.\d{1,2})?$/),
  leverage: z.union([z.literal(2), z.literal(3), z.literal(5)]),
  side: z.enum(["long", "short"]),
  idempotencyKey: z.string().uuid(),
});

type Db = {
  from(table: string): any;
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: any; error: { message?: string } | null }>;
};

const opposite = (direction: "long" | "short") => direction === "long" ? "short" : "long";

export async function POST(request: Request) {
  const appUser = await getAppUser();
  if (!appUser) return NextResponse.json({ error: "Sign in to open a thesis position." }, { status: 401 });

  let config;
  try {
    config = requireExecutionConfig(readPacificaConfig());
  } catch (error) {
    return NextResponse.json({ error: safePacificaMessage(error) }, { status: 503 });
  }
  if (appUser.userId !== config.allowedUserId) {
    return NextResponse.json({ error: "This account is not authorized to trade with the configured Pacifica testnet wallet." }, { status: 403 });
  }

  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Provide a thesis, collateral, 2x/3x/5x leverage, side and UUID idempotency key." }, { status: 400 });
  const input = parsed.data;
  const db = adminClient() as unknown as Db;
  let lockAcquired = false;
  try {
    const lock = await db.rpc("acquire_pacifica_trade_lock_for_user", { p_user_id: appUser.userId, p_lock_key: input.idempotencyKey });
    if (lock.error) return NextResponse.json({ error: "Trading is not ready. Apply the trade lifecycle migration before opening positions." }, { status: 503 });
    if (lock.data !== true) return NextResponse.json({ error: "Another trade is being processed for this account. Wait for it to finish, then retry with the same request." }, { status: 409 });
    lockAcquired = true;

    const thesis = await getThesisBySlug(input.thesisSlug);
    if (!thesis) return NextResponse.json({ error: "This thesis is unavailable for trading." }, { status: 404 });
    const [snapshot, account, positions, leverageSettings] = await Promise.all([
      fetchPacificaSnapshot(),
      getPacificaAccount(),
      getPacificaPositions(),
      getPacificaLeverageSettings(),
    ]);

    if (!account.availableBalance || !new Decimal(account.availableBalance).isFinite()) {
      return NextResponse.json({ error: "Pacifica did not return a usable free balance. No allocation was created." }, { status: 503 });
    }
    if (new Decimal(input.collateral).gt(account.availableBalance)) {
      return NextResponse.json({ error: `Free testnet balance is $${new Decimal(account.availableBalance).toFixed(2)}; reduce collateral before trading.` }, { status: 422 });
    }

    const live = { markets: snapshot.markets, quotes: snapshot.quotes, source: "pacifica-testnet" as const };
    const previewThesis = {
      assets: thesis.assets.map((asset) => ({
        ...asset,
        direction: input.side === "short" ? opposite(asset.direction) : asset.direction,
      })),
    };
    const preview = previewAllocation(previewThesis, input.collateral, input.leverage, live);
    if (!preview.valid) return NextResponse.json({ error: preview.error ?? "This thesis cannot be opened with the current Pacifica market data.", preview }, { status: 422 });

    for (const asset of previewThesis.assets) {
      const position = positions.find((row) => row.symbol === asset.symbol && row.quantity !== "0");
      if (position && position.direction !== asset.direction) {
        return NextResponse.json({ error: `Cannot open ${input.side} because Pacifica already has an opposite ${position.direction} position in ${asset.symbol}.` }, { status: 409 });
      }
      if (position) {
        const market = snapshot.markets.find((row) => row.symbol === asset.symbol);
        const currentLeverage = leverageSettings.get(asset.symbol) ?? market?.maxLeverage;
        if (currentLeverage !== undefined && input.leverage < currentLeverage) {
          return NextResponse.json({ error: `Cannot change ${asset.symbol} from ${currentLeverage}x to ${input.leverage}x while a position is open. Close or increase the existing symbol exposure first.` }, { status: 409 });
        }
      }
    }

    const created = await db.rpc("create_thesis_allocation_for_user", {
      p_user_id: appUser.userId,
      p_thesis_slug: input.thesisSlug,
      p_collateral: input.collateral,
      p_leverage: input.leverage,
      p_side: input.side,
      p_idempotency_key: input.idempotencyKey,
    });
    if (created.error || !created.data?.allocation_id) {
      return NextResponse.json({ error: "The thesis allocation could not be created. Check the migration and thesis requirements." }, { status: 503 });
    }
    const allocationId = String(created.data.allocation_id);
    if (created.data.existing) {
      const existingBatch = await db.from("pacifica_execution_batches")
        .select("id,status")
        .eq("allocation_id", allocationId)
        .eq("idempotency_key", input.idempotencyKey)
        .maybeSingle();
      if (existingBatch.data) {
        const current = await reconcileAllocation(appUser.userId, allocationId).catch(() => null);
        return NextResponse.json({ allocationId, batchId: existingBatch.data.id, status: existingBatch.data.status, idempotentReplay: true, results: current?.confirmed ?? [], unresolvedClientOrderIds: current?.unresolvedClientOrderIds ?? [] });
      }
      if (created.data.status !== "pending") {
        return NextResponse.json({ allocationId, status: created.data.status, idempotentReplay: true, results: [] });
      }
    }

    const legs = await db.from("allocation_legs")
      .select("id,market_id,direction,entry_weight")
      .eq("allocation_id", allocationId);
    const marketIds = (legs.data ?? []).map((row: { market_id: string }) => row.market_id);
    if (legs.error || !marketIds.length) {
      await cancelAllocation(db, allocationId, appUser.userId);
      return NextResponse.json({ error: "The saved thesis legs could not be loaded. The allocation was cancelled." }, { status: 503 });
    }
    const marketRows = await db.from("markets").select("id,symbol").in("id", marketIds);
    if (marketRows.error || marketRows.data?.length !== marketIds.length) {
      await cancelAllocation(db, allocationId, appUser.userId);
      return NextResponse.json({ error: "The thesis market catalogue is incomplete. The allocation was cancelled." }, { status: 503 });
    }
    const symbolByMarket = new Map<string, string>(marketRows.data.map((row: { id: string; symbol: string }) => [row.id, row.symbol]));
    const orderLegs = (legs.data as Array<{ id: string; market_id: string; direction: "long" | "short" }>).map((leg, index) => {
      const sizing = preview.legs.find((row) => row.symbol === symbolByMarket.get(leg.market_id));
      return { legId: leg.id, symbol: symbolByMarket.get(leg.market_id)!, side: leg.direction === "long" ? "bid" as const : "ask" as const, quantity: sizing?.quantity, clientOrderId: randomUUID() };
    });
    if (orderLegs.some((row) => !row.quantity)) {
      await cancelAllocation(db, allocationId, appUser.userId);
      return NextResponse.json({ error: "Pacifica lot-size validation could not calculate every order. The allocation was cancelled." }, { status: 422 });
    }

    const intent = await db.rpc("create_pacifica_execution_intent_for_user", {
      p_user_id: appUser.userId,
      p_allocation_id: allocationId,
      p_idempotency_key: input.idempotencyKey,
      p_legs: orderLegs.map((row) => ({ allocation_leg_id: row.legId, side: row.side, requested_quantity: row.quantity, client_order_id: row.clientOrderId })),
    });
    if (intent.error || !intent.data?.batch_id) {
      await cancelAllocation(db, allocationId, appUser.userId);
      return NextResponse.json({ error: "THESIS could not save the execution intent. No order was sent and the allocation was cancelled." }, { status: 409 });
    }
    const batchId = String(intent.data.batch_id);
    if (intent.data.existing) {
      const current = await reconcileAllocation(appUser.userId, allocationId).catch(() => null);
      return NextResponse.json({ allocationId, batchId, status: intent.data.status, idempotentReplay: true, results: current?.confirmed ?? [] });
    }

    const recordResults = (status: "submitted" | "partial" | "rejected" | "submission_unknown", results: Array<{ client_order_id: string; status: "submitted" | "rejected"; external_id: string | null }>, providerError: string | null) => db.rpc("record_pacifica_execution_results", {
      p_batch_id: batchId,
      p_user_id: appUser.userId,
      p_status: status,
      p_provider_error: providerError,
      p_results: results,
    });

    try {
      for (const row of orderLegs) await setPacificaLeverage(row.symbol, input.leverage);
    } catch (error) {
      const message = safePacificaMessage(error);
      const recorded = await recordResults("rejected", orderLegs.map((row) => ({ client_order_id: row.clientOrderId, status: "rejected" as const, external_id: null })), message);
      const cancelled = await cancelAllocation(db, allocationId, appUser.userId);
      return NextResponse.json({ allocationId, batchId, status: "rejected", error: message, cancelled, reconciliationRequired: Boolean(recorded.error) }, { status: recorded.error || !cancelled ? 202 : 422 });
    }

    let providerResults;
    try {
      providerResults = await submitPacificaMarketBatch(orderLegs.map((row) => ({ symbol: row.symbol, side: row.side, quantity: row.quantity!, clientOrderId: row.clientOrderId, slippagePercent: "1", reduceOnly: false })));
    } catch (error) {
      const message = safePacificaMessage(error);
      await recordResults("submission_unknown", [], message);
      await db.rpc("mark_thesis_allocation_open_for_user", { p_allocation_id: allocationId, p_user_id: appUser.userId });
      return NextResponse.json({ allocationId, batchId, status: "submission_unknown", reconciliationRequired: true, error: "Pacifica submission outcome is unknown. Do not retry; use Reconcile in Portfolio." }, { status: 202 });
    }

    const acceptedCount = providerResults.filter((row) => row.status === "accepted").length;
    const status = acceptedCount === providerResults.length ? "submitted" : acceptedCount === 0 ? "rejected" : "partial";
    const record = await recordResults(status, providerResults.map((row, index) => ({
      client_order_id: orderLegs[index].clientOrderId,
      status: row.status === "accepted" ? "submitted" as const : "rejected" as const,
      external_id: row.externalId ?? null,
    })), acceptedCount === providerResults.length ? null : "One or more Pacifica batch actions were rejected.");
    if (acceptedCount === 0) {
      const cancelled = await cancelAllocation(db, allocationId, appUser.userId);
      return NextResponse.json({ allocationId, batchId, status, cancelled, results: orderLegs.map((row) => ({ symbol: row.symbol, side: row.side, quantity: row.quantity, status: "rejected" })) }, { status: 422 });
    }
    await db.rpc("mark_thesis_allocation_open_for_user", { p_allocation_id: allocationId, p_user_id: appUser.userId });

    let reconciliation = null;
    if (!record.error) reconciliation = await reconcileAllocation(appUser.userId, allocationId).catch(() => null);
    const fillByClientId = new Map((reconciliation?.confirmed ?? []).map((row) => [row.clientOrderId, row]));
    const results = orderLegs.map((row, index) => {
      const provider = providerResults[index];
      const fill = fillByClientId.get(row.clientOrderId);
      return {
        symbol: row.symbol,
        side: row.side,
        quantity: row.quantity,
        status: provider.status === "rejected" ? "rejected" : fill ? "filled" : "accepted_unconfirmed",
        orderId: provider.externalId ?? null,
        fillQuantity: fill?.filledQuantity ?? null,
        fillPrice: fill?.averageFillPrice ?? null,
        fee: fill?.fee ?? null,
      };
    });

    let leverageVerification: { impliedLeverage: string | null; expectedLeverage: number; verified: boolean | null } = { impliedLeverage: null, expectedLeverage: input.leverage, verified: null };
    if (reconciliation?.confirmed.length) {
      try {
        const after = await getPacificaAccount();
        const marginDelta = new Decimal(after.marginUsed ?? "0").minus(account.marginUsed ?? "0");
        const filledNotional = reconciliation.confirmed.reduce((sum, fill) => sum.plus(new Decimal(fill.filledQuantity).mul(fill.averageFillPrice)), new Decimal(0));
        if (marginDelta.gt(0)) {
          const implied = filledNotional.div(marginDelta);
          leverageVerification = { impliedLeverage: implied.toDecimalPlaces(2).toString(), expectedLeverage: input.leverage, verified: implied.minus(input.leverage).abs().lte(0.25) };
        }
      } catch {
        // Keep leverage verification unknown if Pacifica's post-trade account snapshot is unavailable.
      }
    }

    return NextResponse.json({
      allocationId,
      batchId,
      status,
      ...(record.error ? { reconciliationRequired: true, error: "Pacifica accepted the request, but THESIS could not save every per-leg result. Do not retry this trade." } : {}),
      results,
      unresolvedClientOrderIds: reconciliation?.unresolvedClientOrderIds ?? orderLegs.filter((row, index) => providerResults[index].status === "accepted" && !fillByClientId.has(row.clientOrderId)).map((row) => row.clientOrderId),
      leverageVerification,
    }, { status: record.error ? 202 : 200 });
  } catch (error) {
    return NextResponse.json({ error: safePacificaMessage(error) }, { status: 503 });
  } finally {
    if (lockAcquired) await db.rpc("release_pacifica_trade_lock_for_user", { p_user_id: appUser.userId, p_lock_key: input.idempotencyKey }).catch(() => undefined);
  }
}

async function cancelAllocation(db: Db, allocationId: string, userId: string) {
  const result = await db.rpc("cancel_unsubmitted_thesis_allocation_for_user", { p_allocation_id: allocationId, p_user_id: userId });
  return !result.error && result.data === true;
}
