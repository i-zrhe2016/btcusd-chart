import { describe, expect, it } from "vitest";
import { createFixtureCandles } from "./fixtureCandles";

describe("createFixtureCandles", () => {
  it("keeps adjacent candles continuous and valid", () => {
    const candles = createFixtureCandles("15m", "BTCUSD");

    expect(candles).toHaveLength(180);

    candles.forEach((candle, index) => {
      expect(candle.high).toBeGreaterThanOrEqual(Math.max(candle.open, candle.close));
      expect(candle.low).toBeLessThanOrEqual(Math.min(candle.open, candle.close));

      if (index > 0) {
        expect(candle.open).toBe(candles[index - 1].close);
      }
    });
  });

  it("generates deterministic data for each supported market", () => {
    const first = createFixtureCandles("1h", "ETHUSD");
    const second = createFixtureCandles("1h", "ETHUSD");
    const bitcoin = createFixtureCandles("1h", "BTCUSD");

    expect(first).toEqual(second);
    expect(first[first.length - 1].close).not.toBe(bitcoin[bitcoin.length - 1].close);
  });
});
