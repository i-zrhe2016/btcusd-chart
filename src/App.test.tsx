import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import PriceChart from "./components/chart/PriceChart";
import { createFixtureCandles } from "./data/fixtureCandles";
import { useChartStore } from "./stores/chartStore";

const chartMocks = vi.hoisted(() => ({
  applyOptions: vi.fn(),
  createChart: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("lightweight-charts", () => ({
  CandlestickSeries: "CandlestickSeries",
  ColorType: { Solid: "solid" },
  HistogramSeries: "HistogramSeries",
  createChart: chartMocks.createChart,
}));

function createChartMock() {
  return {
    addSeries: vi.fn(() => ({ setData: vi.fn() })),
    applyOptions: chartMocks.applyOptions,
    priceScale: vi.fn(() => ({ applyOptions: vi.fn() })),
    remove: chartMocks.remove,
    timeScale: vi.fn(() => ({ fitContent: vi.fn() })),
  };
}

describe("App", () => {
  beforeEach(() => {
    useChartStore.setState({ symbol: "BTCUSD", interval: "15m" });
    chartMocks.applyOptions.mockReset();
    chartMocks.createChart.mockReset();
    chartMocks.remove.mockReset();
    chartMocks.createChart.mockImplementation(createChartMock);
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

  it("formats a negative summary change with the down tone", () => {
    useChartStore.setState({ symbol: "SOLUSD", interval: "15m" });
    render(<App />);

    const quote = screen.getByRole("region", { name: "SOLUSD quote summary" });
    const change = quote.querySelector(".quote-down");

    expect(change).not.toBeNull();
    expect(change?.textContent?.trim().startsWith("-")).toBe(true);
  });

  it("cleans up the chart instance on unmount", () => {
    const { unmount } = render(<PriceChart candles={createFixtureCandles("15m")} symbol="BTCUSD" />);

    expect(chartMocks.createChart).toHaveBeenCalledTimes(1);
    expect(chartMocks.applyOptions).toHaveBeenCalledWith({
      width: expect.any(Number),
      height: expect.any(Number),
    });
    unmount();
    expect(chartMocks.remove).toHaveBeenCalledTimes(1);
  });
});
