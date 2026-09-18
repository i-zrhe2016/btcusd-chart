import { beforeEach, describe, expect, it, vi } from "vitest";
import { useChartStore } from "./chartStore";

describe("chart store", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
    useChartStore.setState({ symbol: "BTCUSD", interval: "15m" });
  });

  it("updates the selected symbol and interval", () => {
    useChartStore.getState().setSymbol("ETHUSD");
    useChartStore.getState().setInterval("1h");

    expect(useChartStore.getState()).toMatchObject({ symbol: "ETHUSD", interval: "1h" });
  });

  it("hydrates an isolated store from valid URL parameters", async () => {
    window.history.replaceState(null, "", "/?symbol=SOLUSD&interval=4h");
    vi.resetModules();

    const { useChartStore: isolatedStore } = await import("./chartStore");

    expect(isolatedStore.getState()).toMatchObject({ symbol: "SOLUSD", interval: "4h" });
  });

  it("falls back to defaults for invalid URL parameters", async () => {
    window.history.replaceState(null, "", "/?symbol=UNKNOWN&interval=bad");
    vi.resetModules();

    const { useChartStore: isolatedStore } = await import("./chartStore");

    expect(isolatedStore.getState()).toMatchObject({ symbol: "BTCUSD", interval: "15m" });
  });
});
