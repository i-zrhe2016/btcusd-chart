import type { Candle, Interval } from "../types/market";

const intervalSeconds: Record<Interval, number> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1h": 3_600,
  "4h": 14_400,
  "1d": 86_400,
};

const intervalSeeds: Record<Interval, number> = {
  "1m": 0,
  "5m": 11,
  "15m": 23,
  "1h": 37,
  "4h": 53,
  "1d": 71,
};

export function createFixtureCandles(interval: Interval): Candle[] {
  const step = intervalSeconds[interval];
  const seed = intervalSeeds[interval];
  const start = Math.floor(Date.UTC(2024, 4, 6, 12, 0, 0) / 1_000);
  let previousClose = 62_480 + seed * 17;

  return Array.from({ length: 180 }, (_, index) => {
    const wave = Math.sin((index + seed) / 9) * 920;
    const shortWave = Math.cos((index + seed) / 3.7) * 210;
    const drift = index * 11.5;
    const open = previousClose;
    const close = open + Math.sin(index * 1.71 + seed) * 185 + wave / 18 + 28;
    const high = Math.max(open, close) + 95 + Math.abs(shortWave / 5);
    const low = Math.min(open, close) - 88 - Math.abs(shortWave / 7);
    const volume = 18 + Math.abs(Math.sin(index / 5 + seed)) * 34 + (index % 9) * 1.8;

    previousClose = close;

    return {
      time: start + index * step,
      open: open + wave + drift,
      high: high + wave + drift,
      low: low + wave + drift,
      close: close + wave + drift,
      volume,
    };
  });
}
