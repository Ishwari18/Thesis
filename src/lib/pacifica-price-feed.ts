import type { ChartPoint } from "./market-chart";

type FeedSocket = {
  readyState: number;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: (() => void) | null;
  onclose: (() => void) | null;
  send(data: string): void;
  close(): void;
};
type SocketFactory = (url: string) => FeedSocket;

function parsePriceFrame(raw: unknown, symbols: Set<string>): Array<{ symbol: string; point: ChartPoint }> {
  if (typeof raw !== "string") return [];
  try {
    const frame = JSON.parse(raw) as { channel?: string; data?: unknown };
    if (frame.channel !== "prices" || !Array.isArray(frame.data)) return [];
    const points: Array<{ symbol: string; point: ChartPoint }> = [];
    for (const item of frame.data) {
      if (!item || typeof item !== "object") continue;
      const row = item as { symbol?: unknown; mark?: unknown; timestamp?: unknown };
      const value = Number(row.mark);
      if (typeof row.symbol === "string" && symbols.has(row.symbol) && Number.isFinite(value) && value > 0 && typeof row.timestamp === "number" && Number.isFinite(row.timestamp)) {
        points.push({ symbol: row.symbol, point: { timestamp: row.timestamp, value } });
      }
    }
    return points;
  } catch {
    return [];
  }
}

export function managePacificaPriceFeed(
  url: string,
  symbols: string | string[],
  onPrice: (symbol: string, point: ChartPoint) => void,
  onStatus: (status: "live" | "delayed" | "unavailable") => void,
  makeSocket: SocketFactory = (address) => new WebSocket(address) as unknown as FeedSocket,
) {
  const subscribedSymbols = new Set(Array.isArray(symbols) ? symbols : [symbols]);
  let disposed = false;
  let retry = 0;
  let socket: FeedSocket | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let pingTimer: ReturnType<typeof setInterval> | undefined;
  const connect = () => {
    if (disposed) return;
    socket = makeSocket(url);
    const current = socket;
    current.onopen = () => {
      retry = 0;
      onStatus("delayed");
      current.send(JSON.stringify({ method: "subscribe", params: { source: "prices" } }));
      pingTimer = setInterval(() => {
        if (current.readyState === 1) current.send(JSON.stringify({ method: "ping" }));
      }, 30_000);
    };
    current.onmessage = (event) => {
      const points = parsePriceFrame(event.data, subscribedSymbols);
      if (points.length) {
        for (const { symbol, point } of points) onPrice(symbol, point);
        onStatus("live");
      }
    };
    current.onerror = () => onStatus("unavailable");
    current.onclose = () => {
      if (pingTimer) clearInterval(pingTimer);
      if (disposed) return;
      onStatus("delayed");
      const delay = Math.min(30_000, 1_000 * 2 ** retry++);
      reconnectTimer = setTimeout(connect, delay);
    };
  };
  connect();

  return () => {
    disposed = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (pingTimer) clearInterval(pingTimer);
    if (socket?.readyState === 1) socket.send(JSON.stringify({ method: "unsubscribe", params: { source: "prices" } }));
    socket?.close();
  };
}
