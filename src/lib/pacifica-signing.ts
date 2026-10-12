/** Pacifica's canonical off-chain message format, shared by browser and server. */
function recursivelySort(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(recursivelySort);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, recursivelySort(child)]));
  }
  return value;
}

export function pacificaSigningMessage(type: string, data: Record<string, unknown>, timestamp: number, expiryWindow = 30_000) {
  return JSON.stringify(recursivelySort({ timestamp, expiry_window: expiryWindow, type, data }));
}
