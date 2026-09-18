import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import PriceChart from "./components/chart/PriceChart";
import { createFixtureCandles } from "./data/fixtureCandles";
import { useChartStore } from "./stores/chartStore";

const chartMocks = vi.hoisted(() => ({
  applyOptions: vi.fn(),
  candleSetData: vi.fn(),
  candleUpdate: vi.fn(),
  createChart: vi.fn(),
  remove: vi.fn(),
  volumeSetData: vi.fn(),
  volumeUpdate: vi.fn(),
}));

const marketDataMock = vi.hoisted(() => ({
  status: "live" as "live" | "error",
  error: null as { kind: "network"; message: string } | null,
  retry: vi.fn(),
  candlesBySymbol: {
    BTCUSD: [
      { time: 1_715_000_000, open: 62_871, high: 64_000, low: 62_000, close: 63_500, volume: 4_000 },
      { time: 1_715_000_060, open: 63_500, high: 65_624.32, low: 61_489.56, close: 64_270.96, volume: 4_500 },
    ],
    ETHUSD: [
      { time: 1_715_000_000, open: 3_100, high: 3_250, low: 3_050, close: 3_180, volume: 4_000 },
      { time: 1_715_000_060, open: 3_180, high: 3_300, low: 3_120, close: 3_200, volume: 4_500 },
    ],
    SOLUSD: [
      { time: 1_715_000_000, open: 142, high: 145, low: 136, close: 138, volume: 4_000 },
      { time: 1_715_000_060, open: 138, high: 140, low: 130, close: 133, volume: 4_500 },
    ],
    BNBUSD: [
      { time: 1_715_000_000, open: 540, high: 550, low: 530, close: 545, volume: 4_000 },
      { time: 1_715_000_060, open: 545, high: 560, low: 540, close: 552, volume: 4_500 },
    ],
  },
}));

vi.mock("lightweight-charts", () => ({
  CandlestickSeries: "CandlestickSeries",
  ColorType: { Solid: "solid" },
  HistogramSeries: "HistogramSeries",
  createChart: chartMocks.createChart,
}));

vi.mock("./market-data/useMarketData", () => ({
  useMarketData: ({ symbol, interval }: { symbol: keyof typeof marketDataMock.candlesBySymbol; interval: string }) => ({
    key: `${symbol}:${interval}`,
    request: { symbol, interval },
    candles: marketDataMock.candlesBySymbol[symbol],
    status: marketDataMock.status,
    error: marketDataMock.error,
    lastUpdateAt: 1_715_000_120_000,
    retry: marketDataMock.retry,
  }),
}));

function createChartMock() {
  return {
    addSeries: vi.fn((series: string) => series === "CandlestickSeries"
      ? { setData: chartMocks.candleSetData, update: chartMocks.candleUpdate }
      : { setData: chartMocks.volumeSetData, update: chartMocks.volumeUpdate }),
    applyOptions: chartMocks.applyOptions,
    priceScale: vi.fn(() => ({ applyOptions: vi.fn() })),
    remove: chartMocks.remove,
    timeScale: vi.fn(() => ({ fitContent: vi.fn() })),
  };
}

describe("App", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
    useChartStore.setState({ symbol: "BTCUSD", interval: "15m" });
    chartMocks.applyOptions.mockReset();
    chartMocks.candleSetData.mockReset();
    chartMocks.candleUpdate.mockReset();
    chartMocks.createChart.mockReset();
    chartMocks.remove.mockReset();
    chartMocks.volumeSetData.mockReset();
    chartMocks.volumeUpdate.mockReset();
    chartMocks.createChart.mockImplementation(createChartMock);
    marketDataMock.status = "live";
    marketDataMock.error = null;
    marketDataMock.retry.mockReset();
    marketDataMock.candlesBySymbol.BTCUSD[1].volume = 4_500;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("updates the interval, filters the watchlist, and switches symbols", () => {
    render(<App />);

    const quote = screen.getByRole("region", { name: "BTCUSD quote summary" });
    expect(quote.textContent).toContain("64,270.96");
    expect(quote.textContent).toContain("65,624.32");
    expect(quote.textContent).toContain("61,489.56");
    expect(quote.textContent).toContain("+1,399.96 / +2.23%");
    expect(screen.getByRole("button", { name: /BTCUSD/ }).textContent).toContain("64,270.96");

    fireEvent.keyDown(window, { key: "/" });
    expect(document.activeElement).toBe(screen.getByRole("searchbox", { name: "Find symbol" }));

    fireEvent.click(screen.getByRole("button", { name: "1h" }));
    expect(screen.getByRole("button", { name: "1h" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("1h candles")).toBeTruthy();

    fireEvent.change(screen.getByRole("searchbox", { name: "Find symbol" }), {
      target: { value: "ETH" },
    });
    expect(screen.queryByRole("button", { name: /BTCUSD/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /ETHUSD/ }));
    expect(screen.getByRole("heading", { name: "ETHUSD" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "ETHUSD quote summary" })).toBeTruthy();
    expect(document.title).toBe("ETHUSD Chart");
  });

  it("shows a Binance error and exposes a retry action without fixture fallback", () => {
    marketDataMock.status = "error";
    marketDataMock.error = { kind: "network", message: "Binance is offline" };
    render(<App />);

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Binance is offline");
    expect(screen.getByRole("region", { name: "BTCUSD quote summary" }).textContent).toContain("64,270.96");

    fireEvent.click(screen.getByRole("button", { name: "Retry connection" }));
    expect(marketDataMock.retry).toHaveBeenCalledTimes(1);
  });

  it("formats large Binance volumes with a compact unit", () => {
    marketDataMock.candlesBySymbol.BTCUSD[1].volume = 2_500_000;
    render(<App />);

    expect(screen.getByRole("region", { name: "BTCUSD quote summary" }).textContent).toContain("2.5M");
  });

  it("does not intercept the search shortcut when the watchlist is hidden", () => {
    render(<App />);
    document.querySelector<HTMLElement>(".watchlist-panel")?.style.setProperty("display", "none");

    const event = new KeyboardEvent("keydown", { key: "/", cancelable: true });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement).not.toBe(document.getElementById("watchlist-search"));
  });

  it("formats a negative summary change with the down tone", () => {
    useChartStore.setState({ symbol: "SOLUSD", interval: "15m" });
    render(<App />);

    const quote = screen.getByRole("region", { name: "SOLUSD quote summary" });
    const change = quote.querySelector(".quote-down");

    expect(change).not.toBeNull();
    expect(change?.textContent?.trim().startsWith("-")).toBe(true);
  });

  it("opens the active chart in a new browser window", () => {
    const focus = vi.fn();
    const openWindow = vi.spyOn(window, "open").mockReturnValue({ closed: false, focus } as unknown as Window);

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Open chart in new window" }));

    expect(openWindow).toHaveBeenCalledWith(
      expect.stringContaining("symbol=BTCUSD"),
      "_blank",
      expect.stringContaining("popup=yes"),
    );
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it("keeps the current chart state in the browser URL", () => {
    const pushState = vi.spyOn(window.history, "pushState");

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "1h" }));

    expect(window.location.pathname).toBe("/");
    expect(window.location.search).toBe("?symbol=BTCUSD&interval=1h");
    expect(pushState).toHaveBeenCalledWith(null, "", "/?symbol=BTCUSD&interval=1h");
  });

  it("rehydrates chart state when browser history changes", () => {
    render(<App />);

    act(() => {
      window.history.pushState(null, "", "/?symbol=ETHUSD&interval=1h");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    expect(screen.getByRole("heading", { name: "ETHUSD" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "1h" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("shows a retry action when the browser opener reports an error", () => {
    const openWindow = vi.spyOn(window, "open").mockImplementation(() => {
      throw new Error("popup unavailable");
    });

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Open chart in new window" }));

    expect(screen.getByRole("status").textContent).toContain("Allow pop-ups");
    fireEvent.click(screen.getByRole("button", { name: "Retry opening chart window" }));
    expect(openWindow).toHaveBeenCalledTimes(2);
  });

  it("cleans up the chart instance on unmount", () => {
    const { unmount } = render(
      <PriceChart candles={createFixtureCandles("15m")} symbol="BTCUSD" viewKey="BTCUSD:15m" />,
    );

    expect(chartMocks.createChart).toHaveBeenCalledTimes(1);
    expect(chartMocks.applyOptions).toHaveBeenCalledWith({
      width: expect.any(Number),
      height: expect.any(Number),
    });
    unmount();
    expect(chartMocks.remove).toHaveBeenCalledTimes(1);
  });

  it("updates the existing chart series incrementally for a latest-candle change", () => {
    const candles = createFixtureCandles("15m");
    const nextCandles = candles.map((candle, index) => index === candles.length - 1
      ? { ...candle, close: candle.close + 1, high: candle.high + 1 }
      : candle);
    const { rerender } = render(
      <PriceChart candles={candles} symbol="BTCUSD" viewKey="BTCUSD:15m" />,
    );

    rerender(<PriceChart candles={nextCandles} symbol="BTCUSD" viewKey="BTCUSD:15m" />);

    expect(chartMocks.candleSetData).toHaveBeenCalledTimes(1);
    expect(chartMocks.volumeSetData).toHaveBeenCalledTimes(1);
    expect(chartMocks.candleUpdate).toHaveBeenCalledTimes(1);
    expect(chartMocks.volumeUpdate).toHaveBeenCalledTimes(1);
  });
});
