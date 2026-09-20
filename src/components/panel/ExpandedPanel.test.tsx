import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ExpandedPanel from "./ExpandedPanel";
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
  default: ({ onExpand }: { onExpand?: () => void }) => (
    <div data-testid="chart-canvas" onDoubleClick={() => onExpand?.()} />
  ),
}));

function renderExpanded(onClose = vi.fn()) {
  render(
    <ExpandedPanel panelId="panel-1" symbol="BTCUSD" interval="1h" onClose={onClose} />,
  );

  return onClose;
}

describe("ExpandedPanel", () => {
  beforeEach(() => {
    marketDataMock.status = "live";
    marketDataMock.error = null;
    marketDataMock.retry.mockReset();
    marketDataMock.requests = [];
    marketDataMock.candles = [
      { time: 1_715_000_000, open: 62_871, high: 64_000, low: 62_000, close: 63_500, volume: 4_000 },
      { time: 1_715_000_900, open: 63_500, high: 65_624.32, low: 61_489.56, close: 64_270.96, volume: 4_500 },
    ];
  });

  it("subscribes to the same market key as its panel", () => {
    renderExpanded();

    expect(marketDataMock.requests).toEqual([{ symbol: "BTCUSD", interval: "1h" }]);
    expect(screen.getByRole("dialog", { name: "BTCUSD 1h expanded chart" })).toBeTruthy();
  });

  it("closes on Escape", () => {
    const onClose = renderExpanded();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps the focus trap on the dialog itself", () => {
    renderExpanded();

    const dialog = screen.getByRole("dialog");
    const close = screen.getByRole("button", { name: "Close" });

    dialog.focus();
    expect(document.activeElement).toBe(dialog);

    fireEvent.keyDown(window, { key: "Tab" });
    expect(document.activeElement).toBe(close);

    dialog.focus();
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(close);
  });

  it("keeps loaded candles visible and offers retry when the feed errors", () => {
    marketDataMock.status = "error";
    marketDataMock.error = { kind: "network", message: "Binance is offline" };
    renderExpanded();

    expect(screen.getByTestId("chart-canvas")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Binance is offline");

    screen.getByRole("button", { name: "Retry" }).click();

    expect(marketDataMock.retry).toHaveBeenCalledTimes(1);
  });

  it("covers an empty chart with the error and a retry action", () => {
    marketDataMock.status = "error";
    marketDataMock.error = { kind: "network", message: "Binance is offline" };
    marketDataMock.candles = [];
    renderExpanded();

    expect(screen.getByRole("alert").textContent).toContain("Binance is offline");

    screen.getByRole("button", { name: "Retry" }).click();

    expect(marketDataMock.retry).toHaveBeenCalledTimes(1);
  });

  it("shows no message while the feed is live", () => {
    renderExpanded();

    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does not treat a double click on the expanded chart as a dismiss gesture", () => {
    const onClose = renderExpanded();

    fireEvent.doubleClick(screen.getByTestId("chart-canvas"));

    expect(onClose).not.toHaveBeenCalled();
  });
});
