import "server-only";
import { z } from "zod";

export const TESTNET_URL = "https://test-api.pacifica.fi";
const environmentSchema = z.object({
  PACIFICA_NETWORK: z.literal("testnet"),
  PACIFICA_API_BASE_URL: z.string().url().optional(),
  PACIFICA_MARKET_DATA_ENABLED: z.enum(["true","false"]).default("false"),
  PACIFICA_TESTNET_EXECUTION_ENABLED: z.enum(["true","false"]).default("false"),
  PACIFICA_ACCOUNT_ADDRESS: z.string().optional(),
  PACIFICA_PRIVATE_KEY: z.string().optional(),
  PACIFICA_ALLOWED_SUPABASE_USER_ID: z.string().uuid().optional(),
});
export type PacificaConfig = { baseUrl: string; marketDataEnabled: boolean; executionEnabled: boolean; accountAddress?: string; privateKey?: string; allowedUserId?: string };
export class PacificaConfigError extends Error { constructor(message: string) { super(message); this.name="PacificaConfigError"; } }

export function readPacificaConfig(): PacificaConfig {
  const parsed=environmentSchema.safeParse({
    PACIFICA_NETWORK:process.env.PACIFICA_NETWORK ?? "testnet",
    PACIFICA_API_BASE_URL:process.env.PACIFICA_API_BASE_URL,
    PACIFICA_MARKET_DATA_ENABLED:process.env.PACIFICA_MARKET_DATA_ENABLED ?? "false",
    PACIFICA_TESTNET_EXECUTION_ENABLED:process.env.PACIFICA_TESTNET_EXECUTION_ENABLED ?? "false",
    PACIFICA_ACCOUNT_ADDRESS:process.env.PACIFICA_ACCOUNT_ADDRESS,
    PACIFICA_PRIVATE_KEY:process.env.PACIFICA_PRIVATE_KEY,
    PACIFICA_ALLOWED_SUPABASE_USER_ID:process.env.PACIFICA_ALLOWED_SUPABASE_USER_ID,
  });
  if(!parsed.success) throw new PacificaConfigError("Pacifica is restricted to testnet. Set PACIFICA_NETWORK=testnet and use a valid test-api.pacifica.fi base URL.");
  const baseUrl=parsed.data.PACIFICA_API_BASE_URL ?? TESTNET_URL;
  if(baseUrl!==TESTNET_URL) throw new PacificaConfigError("Only https://test-api.pacifica.fi is allowed by this integration.");
  return { baseUrl, marketDataEnabled:parsed.data.PACIFICA_MARKET_DATA_ENABLED==="true", executionEnabled:parsed.data.PACIFICA_TESTNET_EXECUTION_ENABLED==="true", accountAddress:parsed.data.PACIFICA_ACCOUNT_ADDRESS||undefined, privateKey:parsed.data.PACIFICA_PRIVATE_KEY||undefined, allowedUserId:parsed.data.PACIFICA_ALLOWED_SUPABASE_USER_ID };
}

export function requireMarketDataConfig(config=readPacificaConfig()) { if(!config.marketDataEnabled) throw new PacificaConfigError("Pacifica market data is disabled. Set PACIFICA_MARKET_DATA_ENABLED=true to opt in to testnet data."); return config; }
export function requireExecutionConfig(config=readPacificaConfig()) {
  if(!config.executionEnabled) throw new PacificaConfigError("Pacifica testnet execution is disabled. Explicitly enable PACIFICA_TESTNET_EXECUTION_ENABLED=true after configuring the single-account testnet allowlist.");
  if(!config.marketDataEnabled) throw new PacificaConfigError("Testnet execution also requires PACIFICA_MARKET_DATA_ENABLED=true for fresh server-side market validation.");
  if(!config.accountAddress||!config.privateKey||!config.allowedUserId) throw new PacificaConfigError("Execution requires PACIFICA_ACCOUNT_ADDRESS, PACIFICA_PRIVATE_KEY and PACIFICA_ALLOWED_SUPABASE_USER_ID.");
  return config as PacificaConfig & {accountAddress:string;privateKey:string;allowedUserId:string};
}
