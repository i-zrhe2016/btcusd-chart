import type { Candle, Interval, Symbol } from "../types/market";

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

interface FixtureProfile {
  base: number;
  scale: number;
  drift: number;
  seed: number;
}

const symbolProfiles: Record<Symbol, FixtureProfile> = {
  BTCUSD: { base: 62_480, scale: 1, drift: 11.5, seed: 0 },
  ETHUSD: { base: 3_110, scale: 0.055, drift: 0.65, seed: 7 },
  SOLUSD: { base: 142, scale: 0.003, drift: 0.035, seed: 13 },
  BNBUSD: { base: 540, scale: 0.009, drift: 0.09, seed: 19 },
};

export function createFixtureCandles(interval: Interval, symbol: Symbol = "BTCUSD"): Candle[] {
  const step = intervalSeconds[interval];
  const intervalSeed = intervalSeeds[interval];
  const profile = symbolProfiles[symbol];
  const seed = intervalSeed + profile.seed;
  const start = Math.floor(Date.UTC(2024, 4, 6, 12, 0, 0) / 1_000);
  let previousClose = profile.base + intervalSeed * 17 * profile.scale;

  return Array.from({ length: 180 }, (_, index) => {
    const wave = Math.sin((index + seed) / 9) * 920 * profile.scale;
    const shortWave = Math.cos((index + seed) / 3.7) * 210 * profile.scale;
    const drift = index * profile.drift;
    const open = previousClose;
    const close = profile.base + wave + drift + Math.sin(index * 1.71 + seed) * 185 * profile.scale + wave / 18 + 28 * profile.scale;
    const high = Math.max(open, close) + 95 * profile.scale + Math.abs(shortWave / 5);
    const low = Math.min(open, close) - 88 * profile.scale - Math.abs(shortWave / 7);
    const volume = 18 + Math.abs(Math.sin(index / 5 + seed)) * 34 + (index % 9) * 1.8;

    previousClose = close;

    return {
      time: start + index * step,
      open,
      high,
      low,
      close,
      volume,
    };
  });
}
