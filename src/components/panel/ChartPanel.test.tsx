import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ChartPanel from "./ChartPanel";
import type { MarketDataStatus } from "../../market-data/types";

const marketDataMock = vi.hoisted(() => ({
  status: "live" as MarketDataStatus,
  error: null as { kind: "network"; message: string } | null,
  retry: vi.fn(),
  candles: [
    { time: 1_715_000_000, open: 62_871, high: 64_000, low: 62_000, close: 63_500, volume: 4_000 },
    { time: 1_715_000_900, open: 63_500, high: 65_624.32, low: 61_489.56, close: 64_270.96, volume: 4_500 },
  ],
  requests: [] as Array<{ symbol: string; interval: string }>,
}));

vi.mock("../../market-data/useMarketData", () => ({
  useMarketData: (request: { symbol: string; interval: string }) => {
    marketDataMock.requests.push(request);

    return {
      key: `${request.symbol}:${request.interval}`,
      request,
      candles: marketDataMock.candles,
      status: marketDataMock.status,
      error: marketDataMock.error,
      lastUpdateAt: 1_715_000_900_000,
      retry: marketDataMock.retry,
    };
  },
}));

vi.mock("../chart/PriceChart", () => ({
  default: () => <div data-testid="chart-canvas" />,
}));

function renderPanel(overrides: Partial<React.ComponentProps<typeof ChartPanel>> = {}) {
  const onIntervalChange = overrides.onIntervalChange ?? vi.fn();
  const onExpand = overrides.onExpand ?? vi.fn();

  render(
    <ChartPanel
      panelId="panel-1"
      symbol="BTCUSD"
      interval={overrides.interval ?? "15m"}
      onIntervalChange={onIntervalChange}
      onExpand={onExpand}
    />,
  );

  return { onIntervalChange, onExpand };
}

describe("ChartPanel", () => {
  beforeEach(() => {
    marketDataMock.status = "live";
    marketDataMock.error = null;
    marketDataMock.retry.mockReset();
    marketDataMock.requests = [];
  });

  it("shows the fixed market, the last price, and the panel timeframe", () => {
    renderPanel();

    expect(screen.getByText("BTCUSD")).toBeTruthy();
    expect(screen.getByText("64,270.96")).toBeTruthy();
    expect(screen.getByRole("button", { name: "15m" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "1h" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("requests market data only for its own symbol and timeframe", () => {
    renderPanel({ interval: "4h" });

    expect(marketDataMock.requests).toEqual([{ symbol: "BTCUSD", interval: "4h" }]);
  });

  it("reports a timeframe change instead of owning it", () => {
    const { onIntervalChange } = renderPanel({ interval: "15m" });

    screen.getByRole("button", { name: "4h" }).click();

    expect(onIntervalChange).toHaveBeenCalledWith("4h");
  });

  it("renders no message while the feed is live", () => {
    renderPanel();

    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the error and retries the market data", () => {
    marketDataMock.status = "error";
    marketDataMock.error = { kind: "network", message: "Binance is offline" };
    renderPanel();

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Binance is offline");

    screen.getByRole("button", { name: "Retry" }).click();

    expect(marketDataMock.retry).toHaveBeenCalledTimes(1);
  });

  it("announces a stale feed without offering a retry", () => {
    marketDataMock.status = "stale";
    renderPanel();

    expect(screen.getByRole("status").textContent).toContain("Stale");
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });
});
