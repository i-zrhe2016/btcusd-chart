import type { Candle, Interval, Symbol } from "../types/market";

export type MarketDataStatus =
  | "idle"
  | "loading"
  | "connecting"
  | "live"
  | "stale"
  | "disconnected"
  | "reconnecting"
  | "error";

export type MarketDataErrorKind = "network" | "http" | "payload" | "websocket" | "aborted";

export interface MarketDataErrorInfo {
  kind: MarketDataErrorKind;
  message: string;
  status?: number;
}

export interface MarketRequest {
  symbol: Symbol;
  interval: Interval;
}

export type MarketKey = `${Symbol}:${Interval}`;

export interface MarketCandleUpdate {
  request: MarketRequest;
  candle: Candle;
}

export interface MarketDataSnapshot {
  key: MarketKey;
  request: MarketRequest;
  candles: Candle[];
  status: MarketDataStatus;
  error: MarketDataErrorInfo | null;
  lastUpdateAt: number | null;
}

export function createMarketKey(request: MarketRequest): MarketKey {
  return `${request.symbol}:${request.interval}` as MarketKey;
}
