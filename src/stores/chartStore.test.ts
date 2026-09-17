import { beforeEach, describe, expect, it } from "vitest";
import { useChartStore } from "./chartStore";

describe("chart store", () => {
  beforeEach(() => {
    useChartStore.setState({ symbol: "BTCUSD", interval: "15m" });
  });

  it("updates the selected symbol and interval", () => {
    useChartStore.getState().setSymbol("ETHUSD");
    useChartStore.getState().setInterval("1h");

    expect(useChartStore.getState()).toMatchObject({ symbol: "ETHUSD", interval: "1h" });
  });
});
