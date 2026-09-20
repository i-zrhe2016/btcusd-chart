import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const marketDataMock = vi.hoisted(() => ({
  requests: [] as Array<{ symbol: string; interval: string }>,
}));

vi.mock("./market-data/useMarketData", () => ({
  useMarketData: (request: { symbol: string; interval: string }) => {
    marketDataMock.requests.push(request);

    return {
      key: `${request.symbol}:${request.interval}`,
      request,
      candles: [
        { time: 1_715_000_000, open: 62_871, high: 64_000, low: 62_000, close: 63_500, volume: 4_000 },
        { time: 1_715_000_900, open: 63_500, high: 65_624.32, low: 61_489.56, close: 64_270.96, volume: 4_500 },
      ],
      status: "live",
      error: null,
      lastUpdateAt: 1_715_000_900_000,
      retry: vi.fn(),
    };
  },
}));

vi.mock("./components/chart/PriceChart", () => ({
  default: ({ viewKey, onExpand }: { viewKey: string; onExpand?: () => void }) => (
    <div
      data-testid="chart-canvas"
      data-view-key={viewKey}
      onDoubleClick={() => onExpand?.()}
    />
  ),
}));

function chartViewKeys() {
  return screen.getAllByTestId("chart-canvas").map((node) => node.getAttribute("data-view-key"));
}

function timeframeButtons(interval: string) {
  return screen.getAllByRole("button", { name: interval });
}

describe("App", () => {
  beforeEach(() => {
    marketDataMock.requests = [];
  });

  it("renders four panels at 15m, 1h, 4h, and 1d", () => {
    render(<App />);

    expect(screen.getAllByTestId("chart-canvas")).toHaveLength(4);

    ["15m", "1h", "4h", "1d"].forEach((interval) => {
      expect(timeframeButtons(interval)).toHaveLength(4);
    });

    expect(screen.getAllByRole("button", { name: "15m" }).filter(
      (button) => button.getAttribute("aria-pressed") === "true",
    )).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "1h" }).filter(
      (button) => button.getAttribute("aria-pressed") === "true",
    )).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "4h" }).filter(
      (button) => button.getAttribute("aria-pressed") === "true",
    )).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "1d" }).filter(
      (button) => button.getAttribute("aria-pressed") === "true",
    )).toHaveLength(1);
  });

  it("requests four distinct market keys for the four panels", () => {
    render(<App />);

    const keys = new Set(chartViewKeys());

    expect(marketDataMock.requests).toHaveLength(4);
    expect(keys.size).toBe(4);
    expect(marketDataMock.requests.map((request) => request.symbol)).toEqual([
      "BTCUSD",
      "BTCUSD",
      "BTCUSD",
      "BTCUSD",
    ]);
  });

  it("changes one panel timeframe without touching the others", () => {
    render(<App />);

    const before = chartViewKeys();
    const firstPanel = screen.getByLabelText("BTCUSD 15m panel");

    fireEvent.click(within(firstPanel).getByRole("button", { name: "5m" }));

    expect(chartViewKeys()[0]).not.toBe(before[0]);
    expect(chartViewKeys().slice(1)).toEqual(before.slice(1));
    expect(screen.getByLabelText("BTCUSD 5m panel")).toBeTruthy();
  });

  it("keeps the deployment smoke marker in the document title", () => {
    render(<App />);

    expect(document.title).toContain("BTCUSD Chart");
  });

  it("renders no sidebar, watchlist, or quote summary", () => {
    render(<App />);

    expect(document.querySelector(".watchlist-panel")).toBeNull();
    expect(document.querySelector(".topbar")).toBeNull();
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(screen.queryByRole("region", { name: /quote summary/ })).toBeNull();
  });

  it("opens the expanded overlay from a panel double click and closes it", () => {
    render(<App />);

    fireEvent.doubleClick(screen.getAllByTestId("chart-canvas")[2]);

    const dialog = screen.getByRole("dialog", { name: "BTCUSD 4h expanded chart" });
    expect(dialog).toBeTruthy();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
