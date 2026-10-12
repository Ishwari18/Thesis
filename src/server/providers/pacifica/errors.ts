import "server-only";

export type PacificaErrorCode = "configuration" | "network" | "timeout" | "http" | "response" | "execution_disabled" | "unauthorized";

const knownProviderMessages: Record<number, string> = {
  5: "Pacifica reports insufficient available balance. Check free collateral and fees.",
  7: "The order is below Pacifica’s minimum size. Increase collateral or reduce the number of thesis legs.",
  8: "The order exceeds Pacifica’s maximum size. Reduce collateral or split the trade if supported.",
  11: "Pacifica rejected the leverage. Check the market’s leverage limit and existing positions.",
  20: "Pacifica rejected the order type. The requested order type may not be supported by this endpoint.",
  25: "Pacifica could not determine a reasonable execution price. Check live market prices and retry only after reconciliation.",
  28: "Pacifica estimates this order could immediately liquidate the position. Review collateral and leverage.",
  30: "The requested price is too far from the mark price. Check market conditions and slippage settings.",
  36: "This client order ID already exists. Reconcile that order before taking any retry action.",
  52: "The order price does not match Pacifica’s tick size. Check the market’s price increment.",
  59: "Pacifica rejected the order amount. Check amount precision and the market’s lot size.",
  63: "Pacifica has no mark price for this market. Wait for valid market data before trading.",
};

function sanitizeProviderMessage(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const safe = value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\b(signature|private[_ -]?key|authorization|bearer|token)\b\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/\b[0-9a-f]{96,}\b/gi, "[redacted]")
    .replace(/\b[1-9A-HJ-NP-Za-km-z]{64,}\b/g, "[redacted]")
    .replace(/\s+/g, " ")
    .trim();
  return safe ? safe.slice(0, 300) : undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

/** Pacifica error envelopes vary; inspect known fields without assuming an envelope shape. */
export function parsePacificaErrorBody(body: unknown): { providerCode?: number; providerMessage?: string } {
  const queue: Array<{ value: unknown; depth: number }> = [{ value: body, depth: 0 }];
  const seen = new Set<object>();
  let providerCode: number | undefined;
  let providerMessage: string | undefined;
  const messageKeys = ["message", "error", "detail", "msg", "description"];

  while (queue.length) {
    const next = queue.shift();
    if (!next || next.depth > 5) continue;
    const current = next.value;
    const obj = record(current);
    if (!obj || seen.has(obj)) continue;
    seen.add(obj);

    if (providerCode === undefined && typeof obj.code === "number" && Number.isFinite(obj.code)) providerCode = obj.code;
    if (providerMessage === undefined) {
      for (const key of messageKeys) {
        const safe = sanitizeProviderMessage(obj[key]);
        if (safe) { providerMessage = safe; break; }
      }
    }
    // Pacifica has used different envelope shapes; walk bounded JSON values instead
    // of assuming the code and message live under one particular wrapper.
    for (const child of Object.values(obj).slice(0, 32)) queue.push({ value: child, depth: next.depth + 1 });
  }
  return { ...(providerCode === undefined ? {} : { providerCode }), ...(providerMessage ? { providerMessage } : {}) };
}

export class PacificaError extends Error {
  constructor(
    public readonly code: PacificaErrorCode,
    message: string,
    public readonly status?: number,
    public readonly providerCode?: number,
    public readonly providerMessage?: string,
    public readonly endpoint?: string,
  ) {
    super(message);
    this.name = "PacificaError";
  }
}

export function safePacificaMessage(error: unknown) {
  if (error instanceof PacificaError) {
    if (error.providerCode !== undefined && knownProviderMessages[error.providerCode]) return knownProviderMessages[error.providerCode];
    return error.providerMessage ?? error.message;
  }
  return "Pacifica testnet request failed. Check connectivity and try again.";
}

export function pacificaErrorDetails(error: unknown) {
  if (!(error instanceof PacificaError)) return {};
  return {
    ...(error.providerCode === undefined ? {} : { providerCode: error.providerCode }),
    ...(error.providerMessage ? { providerMessage: error.providerMessage } : {}),
    ...(error.status === undefined ? {} : { providerHttpStatus: error.status }),
  };
}
