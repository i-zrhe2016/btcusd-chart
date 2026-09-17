import { describe, expect, it, vi } from "vitest";
import { MarketDataHub } from "./MarketDataHub";
import type { BinanceKlineSocket } from "./binanceAdapter";
import type { Candle } from "../types/market";
import type { MarketRequest } from "./types";

const request: MarketRequest = { symbol: "BTCUSD", interval: "1m" };
const history: Candle[] = [
  { time: 1_715_000_000, open: 100, high: 105, low: 95, close: 101, volume: 12, closed: true },
  { time: 1_715_000_060, open: 101, high: 106, low: 100, close: 102, volume: 13, closed: false },
];

function klineMessage(close: string, openTime = 1_715_000_060, closed = false) {
  return JSON.stringify({
    e: "kline",
    s: "BTCUSDT",
    k: {
      t: openTime * 1_000,
      T: openTime * 1_000 + 59_999,
      s: "BTCUSDT",
      i: "1m",
      o: "101",
      c: close,
      h: "107",
      l: "99",
      v: "15",
      x: closed,
    },
  });
}

function createSocket() {
  const socket: BinanceKlineSocket = {
    onopen: null,
    onmessage: null,
    onerror: null,
    onclose: null,
    close: vi.fn(),
  };

  return socket;
}

async function flushHistory() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("MarketDataHub", () => {
  it("shares one history request and WebSocket between subscribers", async () => {
    const fetchCandles = vi.fn().mockResolvedValue(history);
    const sockets: BinanceKlineSocket[] = [];
    const socketFactory = vi.fn(() => {
      const socket = createSocket();
      sockets.push(socket);
      return socket;
    });
    const hub = new MarketDataHub({
      restClient: { fetchCandles },
      socketFactory,
    });
    const firstListener = vi.fn();
    const secondListener = vi.fn();

    const unsubscribeFirst = hub.subscribeUpdates(request, firstListener);
    const unsubscribeSecond = hub.subscribeUpdates(request, secondListener);
    await flushHistory();

    expect(fetchCandles).toHaveBeenCalledTimes(1);
    expect(socketFactory).toHaveBeenCalledTimes(1);
    expect(socketFactory).toHaveBeenCalledWith("wss://data-stream.binance.vision/ws/btcusdt@kline_1m");
    expect(hub.getSubscriberCount(request)).toBe(2);

    sockets[0].onopen?.(new Event("open"));
    sockets[0].onmessage?.({ data: klineMessage("104") } as MessageEvent);

    expect(hub.getSnapshot(request)).toMatchObject({ status: "live" });
    expect(hub.getSnapshot(request).candles.at(-1)).toMatchObject({ close: 104, closed: false });
    expect(firstListener).toHaveBeenCalledTimes(1);
    expect(secondListener).toHaveBeenCalledTimes(1);

    unsubscribeFirst();
    expect(sockets[0].close).not.toHaveBeenCalled();
    unsubscribeSecond();
    expect(sockets[0].close).toHaveBeenCalledTimes(1);
    expect(hub.getSubscriberCount(request)).toBe(0);
  });

  it("replaces an open candle and appends a closed candle incrementally", async () => {
    const socket = createSocket();
    const hub = new MarketDataHub({
      restClient: { fetchCandles: vi.fn().mockResolvedValue(history) },
      socketFactory: vi.fn(() => socket),
    });
    const listener = vi.fn();
    const unsubscribe = hub.subscribeUpdates(request, listener);
    await flushHistory();
    socket.onopen?.(new Event("open"));

    socket.onmessage?.({ data: klineMessage("103") } as MessageEvent);
    socket.onmessage?.({ data: klineMessage("105", 1_715_000_120, true) } as MessageEvent);

    const candles = hub.getSnapshot(request).candles;
    expect(candles).toHaveLength(3);
    expect(candles[1]).toMatchObject({ time: 1_715_000_060, close: 103, closed: false });
    expect(candles[2]).toMatchObject({ time: 1_715_000_120, close: 105, closed: true });
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("exposes disconnected state and reconnects after a socket close", async () => {
    const firstSocket = createSocket();
    const secondSocket = createSocket();
    const sockets = [firstSocket, secondSocket];
    const scheduled: Array<() => void> = [];
    const hub = new MarketDataHub({
      restClient: { fetchCandles: vi.fn().mockResolvedValue(history) },
      socketFactory: vi.fn(() => sockets.shift()!),
      reconnectDelaysMs: [0],
      setTimeout: vi.fn((handler: () => void) => {
        scheduled.push(handler);
        return scheduled.length as unknown as ReturnType<typeof setTimeout>;
      }),
      clearTimeout: vi.fn(),
    });
    const unsubscribe = hub.subscribe(request, vi.fn());
    await flushHistory();
    firstSocket.onopen?.(new Event("open"));
    firstSocket.onclose?.(new CloseEvent("close"));

    expect(hub.getSnapshot(request).status).toBe("disconnected");
    expect(scheduled.length).toBeGreaterThanOrEqual(2);

    scheduled.at(-1)?.();
    expect(hub.getSnapshot(request).status).toBe("reconnecting");
    expect(sockets).toHaveLength(0);
    secondSocket.onopen?.(new Event("open"));
    expect(hub.getSnapshot(request).status).toBe("live");
    unsubscribe();
  });

  it("marks a live feed stale when no kline update arrives", async () => {
    const socket = createSocket();
    const scheduled: Array<() => void> = [];
    let now = 1_000;
    const hub = new MarketDataHub({
      restClient: { fetchCandles: vi.fn().mockResolvedValue(history) },
      socketFactory: vi.fn(() => socket),
      now: () => now,
      staleAfterMs: 100,
      setTimeout: vi.fn((handler: () => void) => {
        scheduled.push(handler);
        return scheduled.length as unknown as ReturnType<typeof setTimeout>;
      }),
      clearTimeout: vi.fn(),
    });
    const unsubscribe = hub.subscribe(request, vi.fn());
    await flushHistory();
    socket.onopen?.(new Event("open"));

    now = 1_100;
    scheduled.at(-1)?.();

    expect(hub.getSnapshot(request).status).toBe("stale");
    unsubscribe();
  });

  it("surfaces history failures without falling back to fixture candles", async () => {
    const retry = vi.fn();
    const hub = new MarketDataHub({
      restClient: { fetchCandles: vi.fn().mockRejectedValue(new Error("offline")) },
      socketFactory: vi.fn(),
    });
    const unsubscribe = hub.subscribe(request, retry);
    await flushHistory();

    expect(hub.getSnapshot(request)).toMatchObject({
      candles: [],
      status: "error",
      error: { kind: "network", message: "offline" },
    });
    expect(retry).toHaveBeenCalled();
    unsubscribe();
  });
});
