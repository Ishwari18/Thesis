import "server-only";
import { z } from "zod";
import { createPacificaClient, type PacificaClient } from "./client";
import { readPacificaConfig } from "./config";
import { PacificaError } from "./errors";

const responseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    margin_settings: z.array(z.object({ symbol: z.string(), leverage: z.number().int().positive() }).passthrough()).optional(),
  }).passthrough(),
}).passthrough();

export async function getPacificaLeverageSettings(client: PacificaClient = createPacificaClient()) {
  const { accountAddress } = readPacificaConfig();
  if (!accountAddress) throw new PacificaError("configuration", "Set PACIFICA_ACCOUNT_ADDRESS to read the configured testnet account.");
  const raw = await client.get<unknown>("/api/v1/account/settings", { account: accountAddress });
  const response = responseSchema.safeParse(raw);
  if (!response.success || !response.data.success) throw new PacificaError("response", "Pacifica account settings response was invalid.");
  return new Map(response.data.data.margin_settings?.map((setting) => [setting.symbol, setting.leverage]) ?? []);
}
