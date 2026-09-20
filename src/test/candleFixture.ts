import type { Candle } from "../types/market";

export function createCandle(time: number, open: number, close: number): Candle {
  return {
    time,
    open,
    high: Math.max(open, close) + 1,
    low: Math.min(open, close) - 1,
    close,
    volume: 1,
  };
}
