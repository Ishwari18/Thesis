import { afterEach, describe, expect, it, vi } from "vitest";
import { managePacificaPriceFeed } from "./pacifica-price-feed";

class FakeSocket {
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  sent: string[] = [];
  closed = false;
  send(value: string) { this.sent.push(value); }
  close() { this.closed = true; this.readyState = 3; }
  open() { this.readyState = 1; this.onopen?.(); }
  message(data: unknown) { this.onmessage?.({ data }); }
  end() { this.readyState = 3; this.onclose?.(); }
}

afterEach(() => vi.useRealTimers());

describe("Pacifica price feed lifecycle", () => {
  it("subscribes once and forwards only the selected symbol's real price", () => {
    const socket = new FakeSocket();
    const onPrice = vi.fn();
    const onStatus = vi.fn();
    const stop = managePacificaPriceFeed("wss://test-ws.pacifica.fi/ws", ["BTC", "ETH"], onPrice, onStatus, () => socket);
    socket.open();
    socket.message(JSON.stringify({ channel: "prices", data: [
      { symbol: "ETH", mark: "20", timestamp: 100 },
      { symbol: "BTC", mark: "30", timestamp: 101 },
    ] }));
    expect(socket.sent.map((message) => JSON.parse(message))).toEqual([
      { method: "subscribe", params: { source: "prices" } },
    ]);
    expect(onPrice).toHaveBeenNthCalledWith(1, "ETH", { timestamp: 100, value: 20 });
    expect(onPrice).toHaveBeenNthCalledWith(2, "BTC", { timestamp: 101, value: 30 });
    expect(onStatus).toHaveBeenLastCalledWith("live");
    stop();
  });

  it("reconnects after a close and prevents reconnects after cleanup", () => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    const stop = managePacificaPriceFeed("wss://test-ws.pacifica.fi/ws", "BTC", vi.fn(), vi.fn(), () => {
      const socket = new FakeSocket(); sockets.push(socket); return socket;
    });
    sockets[0].end();
    vi.advanceTimersByTime(1_000);
    expect(sockets).toHaveLength(2);
    stop();
    sockets[1].end();
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(2);
  });

  it("unsubscribes, closes the socket, and stops heartbeat work on cleanup", () => {
    vi.useFakeTimers();
    const socket = new FakeSocket();
    const stop = managePacificaPriceFeed("wss://test-ws.pacifica.fi/ws", "BTC", vi.fn(), vi.fn(), () => socket);
    socket.open();
    stop();
    expect(socket.closed).toBe(true);
    expect(socket.sent.map((message) => JSON.parse(message))).toEqual([
      { method: "subscribe", params: { source: "prices" } },
      { method: "unsubscribe", params: { source: "prices" } },
    ]);
    vi.advanceTimersByTime(60_000);
    expect(socket.sent).toHaveLength(2);
  });
});
