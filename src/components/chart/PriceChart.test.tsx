import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PriceChart from "./PriceChart";
import { createFixtureCandles } from "../../data/fixtureCandles";

const chartMocks = vi.hoisted(() => ({
  addSeries: vi.fn(),
  applyOptions: vi.fn(),
  candleSetData: vi.fn(),
  candleUpdate: vi.fn(),
  createChart: vi.fn(),
  dblClickHandler: null as null | (() => void),
  remove: vi.fn(),
  subscribeDblClick: vi.fn(),
}));

vi.mock("lightweight-charts", () => ({
  CandlestickSeries: "CandlestickSeries",
  ColorType: { Solid: "solid" },
  createChart: chartMocks.createChart,
}));

function createChartMock() {
  return {
    addSeries: chartMocks.addSeries,
    applyOptions: chartMocks.applyOptions,
    priceScale: vi.fn(() => ({ applyOptions: vi.fn() })),
    remove: chartMocks.remove,
    subscribeDblClick: chartMocks.subscribeDblClick,
    timeScale: vi.fn(() => ({ fitContent: vi.fn() })),
    unsubscribeDblClick: vi.fn(),
  };
}

function chartOptions() {
  return chartMocks.createChart.mock.calls[0][1] as Record<string, any>;
}

function candleOptions() {
  const call = chartMocks.addSeries.mock.calls.find(([series]) => series === "CandlestickSeries");
  return call?.[1] as Record<string, any>;
}

describe("PriceChart", () => {
  beforeEach(() => {
    chartMocks.addSeries.mockReset();
    chartMocks.applyOptions.mockReset();
    chartMocks.candleSetData.mockReset();
    chartMocks.candleUpdate.mockReset();
    chartMocks.createChart.mockReset();
    chartMocks.dblClickHandler = null;
    chartMocks.remove.mockReset();
    chartMocks.subscribeDblClick.mockReset();
    chartMocks.createChart.mockImplementation(createChartMock);
    chartMocks.addSeries.mockImplementation(() => ({
      setData: chartMocks.candleSetData,
      update: chartMocks.candleUpdate,
    }));
    chartMocks.subscribeDblClick.mockImplementation((handler: () => void) => {
      chartMocks.dblClickHandler = handler;
    });
  });

  it("renders a pure-black surface with both grid line sets hidden", () => {
    render(<PriceChart candles={createFixtureCandles("15m")} symbol="BTCUSD" viewKey="BTCUSD:15m" />);

    const options = chartOptions();

    expect(options.layout.background).toEqual({ type: "solid", color: "#000000" });
    expect(options.grid.vertLines.visible).toBe(false);
    expect(options.grid.horzLines.visible).toBe(false);
  });

  it("configures rising candles as hollow white-outlined bodies", () => {
    render(<PriceChart candles={createFixtureCandles("15m")} symbol="BTCUSD" viewKey="BTCUSD:15m" />);

    const options = candleOptions();

    expect(options.upColor).toBe("#000000");
    expect(options.borderVisible).toBe(true);
    expect(options.borderUpColor).toBe("#ffffff");
    expect(options.wickUpColor).toBe("#ffffff");
  });

  it("configures falling candles as filled white bodies", () => {
    render(<PriceChart candles={createFixtureCandles("15m")} symbol="BTCUSD" viewKey="BTCUSD:15m" />);

    const options = candleOptions();

    expect(options.downColor).toBe("#ffffff");
    expect(options.borderDownColor).toBe("#ffffff");
    expect(options.wickDownColor).toBe("#ffffff");
  });

  it("renders candles only, with no volume series", () => {
    render(<PriceChart candles={createFixtureCandles("15m")} symbol="BTCUSD" viewKey="BTCUSD:15m" />);

    expect(chartMocks.addSeries).toHaveBeenCalledTimes(1);
    expect(chartMocks.addSeries).toHaveBeenCalledWith("CandlestickSeries", expect.anything());
  });

  it("keeps every chart color inside the black, white, and gray set", () => {
    render(<PriceChart candles={createFixtureCandles("15m")} symbol="BTCUSD" viewKey="BTCUSD:15m" />);

    const allowed = new Set(["#000000", "#ffffff", "#e6e6e6", "#b4b4b4", "#8a8a8a", "#5a5a5a", "#2a2a2a"]);
    const colors = [
      chartOptions().layout.background.color,
      chartOptions().layout.textColor,
      chartOptions().rightPriceScale.borderColor,
      chartOptions().timeScale.borderColor,
      chartOptions().crosshair.vertLine.color,
      chartOptions().crosshair.horzLine.color,
      candleOptions().upColor,
      candleOptions().downColor,
      candleOptions().borderUpColor,
      candleOptions().borderDownColor,
      candleOptions().wickUpColor,
      candleOptions().wickDownColor,
    ];

    colors.forEach((color) => expect(allowed.has(color)).toBe(true));
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

  it("updates the existing candle series incrementally for a latest-candle change", () => {
    const candles = createFixtureCandles("15m");
    const nextCandles = candles.map((candle, index) => index === candles.length - 1
      ? { ...candle, close: candle.close + 1, high: candle.high + 1 }
      : candle);
    const { rerender } = render(
      <PriceChart candles={candles} symbol="BTCUSD" viewKey="BTCUSD:15m" />,
    );

    rerender(<PriceChart candles={nextCandles} symbol="BTCUSD" viewKey="BTCUSD:15m" />);

    expect(chartMocks.candleSetData).toHaveBeenCalledTimes(1);
    expect(chartMocks.candleUpdate).toHaveBeenCalledTimes(1);
  });

  it("reports a double click on the chart surface", () => {
    const onExpand = vi.fn();

    render(
      <PriceChart
        candles={createFixtureCandles("15m")}
        symbol="BTCUSD"
        viewKey="BTCUSD:15m"
        onExpand={onExpand}
      />,
    );

    expect(chartMocks.subscribeDblClick).toHaveBeenCalledTimes(1);
    chartMocks.dblClickHandler?.();

    expect(onExpand).toHaveBeenCalledTimes(1);
  });
});
