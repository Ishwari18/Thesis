import "server-only";
import { z } from "zod";
import { createPacificaClient, type PacificaClient } from "./client";
import { readPacificaConfig } from "./config";
import { PacificaError } from "./errors";

const envelopeSchema = z.object({
  success: z.boolean(),
  data: z.array(z.unknown()),
  next_cursor: z.string().nullable().optional(),
  has_more: z.boolean().optional(),
}).passthrough();

const tradeSchema = z.object({
  order_id: z.union([z.string(), z.number()]).optional(),
  client_order_id: z.string().uuid().nullable().optional(),
  symbol: z.string(),
  amount: z.string(),
  price: z.string(),
  fee: z.string().optional().default("0"),
  event_type: z.enum(["fulfill_taker", "fulfill_maker"]),
  side: z.enum(["open_long", "open_short", "close_long", "close_short"]),
  created_at: z.number().optional(),
}).passthrough();

export type PacificaTrade = z.infer<typeof tradeSchema>;

export async function getPacificaTradeHistory(options: {
  startTime?: number;
  maxPages?: number;
  timeoutMs?: number;
  accountAddress?: string;
  client?: PacificaClient;
} = {}) {
  const client = options.client ?? createPacificaClient(fetch, options.timeoutMs ?? 1_200);
  const { accountAddress: configuredAddress } = readPacificaConfig();
  const accountAddress = options.accountAddress ?? configuredAddress;
  if (!accountAddress) throw new PacificaError("configuration", "A linked Solana wallet is required to read Pacifica testnet trade history.");

  const trades: PacificaTrade[] = [];
  let cursor: string | undefined;
  let hasMore = false;
  const maxPages = Math.max(1, Math.min(options.maxPages ?? 3, 10));
  for (let page = 0; page < maxPages; page += 1) {
    const params: Record<string, string> = { account: accountAddress, limit: "100" };
    if (options.startTime !== undefined) params.start_time = String(Math.max(0, Math.floor(options.startTime)));
    if (cursor) params.cursor = cursor;
    const raw = await client.get<unknown>("/api/v1/trades/history", params);
    const response = envelopeSchema.safeParse(raw);
    if (!response.success || !response.data.success) throw new PacificaError("response", "Pacifica trade history response was invalid.");
    for (const item of response.data.data) {
      const trade = tradeSchema.safeParse(item);
      if (trade.success) trades.push(trade.data);
    }
    hasMore = response.data.has_more ?? Boolean(response.data.next_cursor);
    cursor = response.data.next_cursor ?? undefined;
    if (!hasMore || !cursor) break;
  }
  return { trades, hasMore };
}
