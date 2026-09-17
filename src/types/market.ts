export const INTERVALS = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;

export type Interval = (typeof INTERVALS)[number];

export const SYMBOLS = ["BTCUSD", "ETHUSD", "SOLUSD", "BNBUSD"] as const;

export type Symbol = (typeof SYMBOLS)[number];

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface WatchlistItem {
  symbol: Symbol;
  venue: string;
}

export interface WatchlistQuote extends WatchlistItem {
  price: string;
  change: string;
  tone: "up" | "down" | "muted";
}
