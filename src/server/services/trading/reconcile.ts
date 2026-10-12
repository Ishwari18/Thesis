import "server-only";
import Decimal from "decimal.js";
import { adminClient } from "@/lib/auth/server";
import { getPacificaTradeHistory } from "@/server/providers/pacifica/trade-history";

type DbError = { message?: string } | null;
type DbResult<T = unknown> = { data: T; error: DbError };
type DbQuery<T = unknown> = PromiseLike<DbResult<T>> & {
  select(columns: string): DbQuery<T>;
  eq(column: string, value: string): DbQuery<T>;
  in(column: string, values: string[]): DbQuery<T>;
  order(column: string, options: { ascending: boolean }): DbQuery<T>;
  maybeSingle(): Promise<DbResult<T>>;
};
type TradingDb = {
  from(table: string): DbQuery<any>;
  rpc(name: string, args: Record<string, unknown>): Promise<DbResult<any>>;
};

export type ReconcileResult = {
  allocationId: string;
  confirmed: Array<{ clientOrderId: string; filledQuantity: string; averageFillPrice: string; fee: string; kind: string }>;
  unresolvedClientOrderIds: string[];
  hasMoreHistory: boolean;
};

export async function reconcileAllocation(userId: string, allocationId: string, walletAddress?: string): Promise<ReconcileResult> {
  const db = adminClient() as unknown as TradingDb;
  const allocationResult = await db.from("thesis_allocations")
    .select("id,status")
    .eq("id", allocationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (allocationResult.error || !allocationResult.data) throw new Error("Allocation not found.");

  const legsResult = await db.from("allocation_legs").select("id").eq("allocation_id", allocationId);
  if (legsResult.error) throw new Error("Could not load thesis allocation legs.");
  const legIds = (legsResult.data ?? []).map((row: { id: string }) => row.id);
  if (!legIds.length) return { allocationId, confirmed: [], unresolvedClientOrderIds: [], hasMoreHistory: false };

  const executionResult = await db.from("executions")
    .select("id,batch_id,allocation_leg_id,client_order_id,requested_quantity,filled_quantity,average_fill_price,fee,status,kind,created_at")
    .in("allocation_leg_id", legIds);
  if (executionResult.error) throw new Error("Could not load thesis executions.");
  const allExecutions = executionResult.data ?? [];
  const targetExecutions = allExecutions.filter((row: any) =>
    ["submitted", "partially_filled", "submission_unknown"].includes(row.status) && row.batch_id && row.client_order_id,
  );
  if (!targetExecutions.length) return { allocationId, confirmed: [], unresolvedClientOrderIds: [], hasMoreHistory: false };

  const batchesResult = await db.from("pacifica_execution_batches")
    .select("id,created_at,kind")
    .in("id", [...new Set<string>(targetExecutions.map((row: any) => String(row.batch_id)))]);
  if (batchesResult.error) throw new Error("Could not load thesis execution batches.");
  const batchById = new Map((batchesResult.data ?? []).map((row: any) => [row.id, row]));
  const earliest = Math.min(...targetExecutions.map((row: any) => {
    const batch = batchById.get(row.batch_id) as { created_at?: string } | undefined;
    return Date.parse(batch?.created_at ?? row.created_at ?? new Date().toISOString()) - 60_000;
  }));

  // A short client timeout keeps this route bounded. If history has not caught
  // up yet, executions remain submitted/unknown and the UI offers reconciliation.
  let history = await getPacificaTradeHistory({ startTime: earliest, maxPages: 2, timeoutMs: 1_200, accountAddress: walletAddress });
  // Pacifica can publish fills shortly after accepting an order. One bounded
  // follow-up read catches the common propagation delay without holding the
  // open/close response beyond a few seconds.
  if (targetExecutions.some((row: any) => !history.trades.some((trade) => trade.client_order_id === row.client_order_id))) {
    await new Promise((resolve) => setTimeout(resolve, 350));
    history = await getPacificaTradeHistory({ startTime: earliest, maxPages: 2, timeoutMs: 1_200, accountAddress: walletAddress });
  }
  const targetByClientId = new Map(targetExecutions.map((row: any) => [row.client_order_id, row]));
  const totals = new Map<string, { quantity: Decimal; notional: Decimal; fee: Decimal }>();
  for (const trade of history.trades) {
    if (!trade.client_order_id) continue;
    const execution = targetByClientId.get(trade.client_order_id) as any;
    if (!execution) continue;
    const batch = batchById.get(execution.batch_id) as { kind?: string } | undefined;
    if (batch?.kind === "open" && !trade.side.startsWith("open_")) continue;
    if (batch?.kind === "close" && !trade.side.startsWith("close_")) continue;
    try {
      const amount = new Decimal(trade.amount);
      const price = new Decimal(trade.price);
      const fee = new Decimal(trade.fee);
      if (!amount.isFinite() || amount.lte(0) || !price.isFinite() || price.lte(0) || !fee.isFinite() || fee.lt(0)) continue;
      const total = totals.get(trade.client_order_id) ?? { quantity: new Decimal(0), notional: new Decimal(0), fee: new Decimal(0) };
      total.quantity = total.quantity.plus(amount);
      total.notional = total.notional.plus(amount.mul(price));
      total.fee = total.fee.plus(fee);
      totals.set(trade.client_order_id, total);
    } catch {
      // Ignore malformed rows; the order remains unconfirmed and can be retried.
    }
  }

  const byBatch = new Map<string, Array<{ client_order_id: string; filled_quantity: string; average_fill_price: string; fee: string }>>();
  for (const [clientOrderId, total] of totals) {
    const execution = targetByClientId.get(clientOrderId) as any;
    if (!execution?.batch_id || total.quantity.lte(0)) continue;
    const results = byBatch.get(execution.batch_id) ?? [];
    results.push({
      client_order_id: clientOrderId,
      filled_quantity: total.quantity.toString(),
      average_fill_price: total.notional.div(total.quantity).toSignificantDigits(16).toString(),
      fee: total.fee.toString(),
    });
    byBatch.set(execution.batch_id, results);
  }

  for (const [batchId, results] of byBatch) {
    const confirmedResult = await db.rpc("confirm_pacifica_execution_fills_for_user", {
      p_batch_id: batchId,
      p_user_id: userId,
      p_results: results,
    });
    if (confirmedResult.error) throw new Error("Pacifica fill evidence could not be recorded. Reconcile again before trading.");
  }

  const confirmed = [...totals].map(([clientOrderId, total]) => {
    const execution = targetByClientId.get(clientOrderId) as any;
    const batch = batchById.get(execution.batch_id) as { kind?: string } | undefined;
    return {
      clientOrderId,
      filledQuantity: total.quantity.toString(),
      averageFillPrice: total.notional.div(total.quantity).toSignificantDigits(16).toString(),
      fee: total.fee.toString(),
      kind: batch?.kind ?? "open",
    };
  });
  const confirmedIds = new Set(confirmed.map((row) => row.clientOrderId));
  const unresolvedClientOrderIds = targetExecutions
    .filter((row: any) => !confirmedIds.has(row.client_order_id))
    .map((row: any) => row.client_order_id as string);
  return { allocationId, confirmed, unresolvedClientOrderIds, hasMoreHistory: history.hasMore };
}
