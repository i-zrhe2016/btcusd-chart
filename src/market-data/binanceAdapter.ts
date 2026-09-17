import type { Candle, Interval, Symbol } from "../types/market";
import type { MarketCandleUpdate, MarketDataErrorKind, MarketRequest } from "./types";

export const DEFAULT_BINANCE_REST_BASE_URL = "https://data-api.binance.vision";
export const DEFAULT_BINANCE_WS_BASE_URL = "wss://data-stream.binance.vision/ws";
export const DEFAULT_HISTORY_LIMIT = 500;

export const BINANCE_SYMBOL_MAP: Record<Symbol, string> = {
  BTCUSD: "BTCUSDT",
  ETHUSD: "ETHUSDT",
  SOLUSD: "SOLUSDT",
  BNBUSD: "BNBUSDT",
};

export const BINANCE_INTERVAL_MAP: Record<Interval, string> = {
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "1h": "1h",
  "4h": "4h",
  "1d": "1d",
};

export class BinanceMarketDataError extends Error {
  readonly kind: MarketDataErrorKind;
  readonly status?: number;

  constructor(kind: MarketDataErrorKind, message: string, status?: number) {
    super(message);
    this.name = "BinanceMarketDataError";
    this.kind = kind;
    this.status = status;
  }
}

export interface BinanceKlineSocket {
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  close: () => void;
}

export type BinanceWebSocketFactory = (url: string) => BinanceKlineSocket;

export interface BinanceHistoryClient {
  fetchCandles: (request: MarketRequest, limit?: number, signal?: AbortSignal) => Promise<Candle[]>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseNumber(value: unknown, field: string): number {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim() !== ""
      ? Number(value)
      : Number.NaN;

  if (!Number.isFinite(parsed)) {
    throw new BinanceMarketDataError("payload", `Binance kline field ${field} is not numeric`);
  }

  return parsed;
}

function parseNonNegativeNumber(value: unknown, field: string): number {
  const parsed = parseNumber(value, field);

  if (parsed < 0) {
    throw new BinanceMarketDataError("payload", `Binance kline field ${field} cannot be negative`);
  }

  return parsed;
}

function parseTimestampMilliseconds(value: unknown, field: string): number {
  const parsed = parseNumber(value, field);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new BinanceMarketDataError("payload", `Binance kline field ${field} must be a positive millisecond timestamp`);
  }

  return parsed;
}

function parseKlineValues(
  values: {
    openTime: unknown;
    closeTime: unknown;
    open: unknown;
    high: unknown;
    low: unknown;
    close: unknown;
    volume: unknown;
    closed: boolean;
  },
): Candle {
  const openTimeMilliseconds = parseTimestampMilliseconds(values.openTime, "open time");
  const closeTimeMilliseconds = parseTimestampMilliseconds(values.closeTime, "close time");
  const open = parseNonNegativeNumber(values.open, "open");
  const high = parseNonNegativeNumber(values.high, "high");
  const low = parseNonNegativeNumber(values.low, "low");
  const close = parseNonNegativeNumber(values.close, "close");
  const volume = parseNonNegativeNumber(values.volume, "volume");

  if (closeTimeMilliseconds < openTimeMilliseconds) {
    throw new BinanceMarketDataError("payload", "Binance kline close time precedes open time");
  }

  if (high < Math.max(open, close) || low > Math.min(open, close)) {
    throw new BinanceMarketDataError("payload", "Binance kline OHLC bounds are invalid");
  }

  const time = Math.floor(openTimeMilliseconds / 1_000);

  if (time <= 0) {
    throw new BinanceMarketDataError("payload", "Binance kline open time must be at least one second");
  }

  return {
    time,
    open,
    high,
    low,
    close,
    volume,
    closed: values.closed,
  };
}

export function toBinanceSymbol(symbol: Symbol): string {
  return BINANCE_SYMBOL_MAP[symbol];
}

export function fromBinanceSymbol(value: unknown): Symbol {
  if (typeof value !== "string") {
    throw new BinanceMarketDataError("payload", "Binance kline symbol is missing");
  }

  const normalized = value.toUpperCase();
  const match = (Object.entries(BINANCE_SYMBOL_MAP) as Array<[Symbol, string]>).find(
    ([, binanceSymbol]) => binanceSymbol === normalized,
  );

  if (!match) {
    throw new BinanceMarketDataError("payload", `Unsupported Binance symbol ${normalized}`);
  }

  return match[0];
}

export function toBinanceInterval(interval: Interval): string {
  return BINANCE_INTERVAL_MAP[interval];
}

export function fromBinanceInterval(value: unknown): Interval {
  if (typeof value !== "string") {
    throw new BinanceMarketDataError("payload", "Binance kline interval is missing");
  }

  const match = (Object.entries(BINANCE_INTERVAL_MAP) as Array<[Interval, string]>).find(
    ([, binanceInterval]) => binanceInterval === value,
  );

  if (!match) {
    throw new BinanceMarketDataError("payload", `Unsupported Binance interval ${value}`);
  }

  return match[0];
}

export function buildBinanceKlineStreamUrl(
  request: MarketRequest,
  baseUrl = DEFAULT_BINANCE_WS_BASE_URL,
): string {
  const streamName = `${toBinanceSymbol(request.symbol).toLowerCase()}@kline_${toBinanceInterval(request.interval)}`;
  return `${baseUrl.replace(/\/+$/, "")}/${streamName}`;
}

export function parseBinanceRestKline(row: unknown, nowMilliseconds = Date.now()): Candle {
  if (!Array.isArray(row) || row.length < 7) {
    throw new BinanceMarketDataError("payload", "Binance REST kline must contain at least seven fields");
  }

  const closeTimeMilliseconds = parseTimestampMilliseconds(row[6], "close time");

  return parseKlineValues({
    openTime: row[0],
    closeTime: closeTimeMilliseconds,
    open: row[1],
    high: row[2],
    low: row[3],
    close: row[4],
    volume: row[5],
    closed: closeTimeMilliseconds < nowMilliseconds,
  });
}

export function parseBinanceRestKlines(payload: unknown, nowMilliseconds = Date.now()): Candle[] {
  if (!Array.isArray(payload)) {
    throw new BinanceMarketDataError("payload", "Binance REST klines response must be an array");
  }

  const candles = payload.map((row) => parseBinanceRestKline(row, nowMilliseconds));

  candles.forEach((candle, index) => {
    if (index > 0 && candle.time <= candles[index - 1].time) {
      throw new BinanceMarketDataError("payload", "Binance REST klines must be strictly chronological");
    }
  });

  return candles;
}

function parseMessagePayload(payload: unknown): unknown {
  if (typeof payload !== "string") {
    return payload;
  }

  try {
    return JSON.parse(payload) as unknown;
  } catch {
    throw new BinanceMarketDataError("payload", "Binance WebSocket message is not valid JSON");
  }
}

export function parseBinanceKlineMessage(payload: unknown): MarketCandleUpdate {
  const parsed = parseMessagePayload(payload);
  const envelope = isRecord(parsed) && "data" in parsed ? parsed.data : parsed;

  if (!isRecord(envelope) || envelope.e !== "kline" || !isRecord(envelope.k)) {
    throw new BinanceMarketDataError("payload", "Binance WebSocket message is not a kline event");
  }

  const kline = envelope.k;
  const symbol = fromBinanceSymbol(kline.s ?? envelope.s);
  const interval = fromBinanceInterval(kline.i);

  if (typeof kline.x !== "boolean") {
    throw new BinanceMarketDataError("payload", "Binance WebSocket kline close state is invalid");
  }

  const request: MarketRequest = { symbol, interval };
  const candle = parseKlineValues({
    openTime: kline.t,
    closeTime: kline.T,
    open: kline.o,
    high: kline.h,
    low: kline.l,
    close: kline.c,
    volume: kline.v,
    closed: kline.x,
  });

  return { request, candle };
}

export function createDefaultBinanceWebSocketFactory(): BinanceWebSocketFactory {
  return (url) => new WebSocket(url) as BinanceKlineSocket;
}

function readErrorMessage(payload: unknown): string | null {
  if (!isRecord(payload) || typeof payload.msg !== "string") {
    return null;
  }

  return payload.msg;
}

export interface BinanceRestClientOptions {
  baseUrl?: string;
  fetcher?: typeof fetch;
  now?: () => number;
}

export class BinanceRestClient implements BinanceHistoryClient {
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;

  constructor(options: BinanceRestClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BINANCE_REST_BASE_URL;
    this.fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
    this.now = options.now ?? Date.now;
  }

  async fetchCandles(request: MarketRequest, limit = DEFAULT_HISTORY_LIMIT, signal?: AbortSignal): Promise<Candle[]> {
    const boundedLimit = Math.max(1, Math.min(1_000, Math.trunc(limit)));
    const url = new URL("/api/v3/klines", this.baseUrl);
    url.searchParams.set("symbol", toBinanceSymbol(request.symbol));
    url.searchParams.set("interval", toBinanceInterval(request.interval));
    url.searchParams.set("limit", String(boundedLimit));

    let response: Response;

    try {
      response = await this.fetcher(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal,
      });
    } catch (error) {
      if (signal?.aborted) {
        throw new BinanceMarketDataError("aborted", "Binance history request was cancelled");
      }

      throw new BinanceMarketDataError(
        "network",
        error instanceof Error ? error.message : "Binance history request failed",
      );
    }

    let payload: unknown;

    try {
      payload = await response.json();
    } catch {
      throw new BinanceMarketDataError("payload", "Binance history response was not valid JSON", response.status);
    }

    if (!response.ok) {
      throw new BinanceMarketDataError(
        "http",
        readErrorMessage(payload) ?? `Binance history request failed with HTTP ${response.status}`,
        response.status,
      );
    }

    return parseBinanceRestKlines(payload, this.now());
  }
}
