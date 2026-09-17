export const INTERVALS = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;

export type Interval = (typeof INTERVALS)[number];

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface WatchlistItem {
  symbol: string;
  venue: string;
  price: string;
  change: string;
  tone: "up" | "down" | "muted";
}
