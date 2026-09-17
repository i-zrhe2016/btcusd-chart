import { describe, expect, it, vi } from "vitest";
import {
  BinanceMarketDataError,
  BinanceRestClient,
  buildBinanceKlineStreamUrl,
  parseBinanceKlineMessage,
  parseBinanceRestKlines,
  toBinanceSymbol,
} from "./binanceAdapter";

const firstOpenTime = 1_715_000_000_000;

function restKline(openTime: number, closeTime: number, close = "101") {
  return [openTime, "100", "105", "95", close, "12.5", closeTime, "1250", 10, "6", "600", "0"];
}

describe("Binance market-data adapter", () => {
  it("normalizes app symbols and REST timestamps into chart candles", () => {
    const candles = parseBinanceRestKlines([
      restKline(firstOpenTime, firstOpenTime + 59_999),
      restKline(firstOpenTime + 60_000, firstOpenTime + 119_999, "102"),
    ], firstOpenTime + 180_000);

    expect(toBinanceSymbol("BTCUSD")).toBe("BTCUSDT");
    expect(candles).toEqual([
      {
        time: 1_715_000_000,
        open: 100,
        high: 105,
        low: 95,
        close: 101,
        volume: 12.5,
        closed: true,
      },
      {
        time: 1_715_000_060,
        open: 100,
        high: 105,
        low: 95,
        close: 102,
        volume: 12.5,
        closed: true,
      },
    ]);
  });

  it("parses raw and combined WebSocket kline messages", () => {
    const message = {
      e: "kline",
      s: "BTCUSDT",
      k: {
        t: firstOpenTime,
        T: firstOpenTime + 59_999,
        s: "BTCUSDT",
        i: "1m",
        o: "100",
        c: "103",
        h: "105",
        l: "99",
        v: "14",
        x: false,
      },
    };

    const update = parseBinanceKlineMessage(JSON.stringify({ stream: "btcusdt@kline_1m", data: message }));

    expect(update.request).toEqual({ symbol: "BTCUSD", interval: "1m" });
    expect(update.candle).toMatchObject({ time: 1_715_000_000, close: 103, volume: 14, closed: false });
  });

  it("builds a lowercase Binance stream URL", () => {
    expect(buildBinanceKlineStreamUrl({ symbol: "BTCUSD", interval: "15m" }))
      .toBe("wss://data-stream.binance.vision/ws/btcusdt@kline_15m");
  });

  it("rejects malformed or non-chronological REST payloads", () => {
    expect(() => parseBinanceRestKlines([restKline(firstOpenTime + 60_000, firstOpenTime + 119_999), restKline(firstOpenTime, firstOpenTime + 59_999)]))
      .toThrow("strictly chronological");
    expect(() => parseBinanceRestKlines([[firstOpenTime, "not-a-price"]])).toThrow(BinanceMarketDataError);
  });

  it("classifies REST HTTP and network failures", async () => {
    const httpClient = new BinanceRestClient({
      baseUrl: "https://example.test",
      fetcher: vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: -1121, msg: "Invalid symbol." }), { status: 400 })),
    });
    const networkClient = new BinanceRestClient({
      fetcher: vi.fn().mockRejectedValue(new Error("offline")),
    });

    await expect(httpClient.fetchCandles({ symbol: "BTCUSD", interval: "1m" })).rejects.toMatchObject({ kind: "http", status: 400 });
    await expect(networkClient.fetchCandles({ symbol: "BTCUSD", interval: "1m" })).rejects.toMatchObject({ kind: "network" });
  });
});
