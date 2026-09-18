import { describe, expect, it, vi } from "vitest";
import {
  createChartWindowUrl,
  DEFAULT_CHART_WINDOW_STATE,
  openChartWindow,
  parseChartWindowState,
  type ChartWindowReadyChannelFactory,
} from "./chartWindow";

describe("chart window state", () => {
  it("serializes the active chart while preserving the current route", () => {
    const url = createChartWindowUrl(
      { symbol: "ETHUSD", interval: "1h" },
      "https://chart.example/workspace?source=watchlist#private-state",
    );

    expect(url).toBe("https://chart.example/workspace?symbol=ETHUSD&interval=1h");
    expect(createChartWindowUrl(
      { symbol: "ETHUSD", interval: "1h" },
      "https://chart.example/workspace?tenant=demo&jwt=example#access_token=example",
    )).toBe("https://chart.example/workspace?symbol=ETHUSD&interval=1h");
  });

  it("hydrates valid state and falls back independently for invalid parameters", () => {
    expect(parseChartWindowState("?symbol=SOLUSD&interval=4h")).toEqual({ symbol: "SOLUSD", interval: "4h" });
    expect(parseChartWindowState("?symbol=UNKNOWN&interval=bad")).toEqual(DEFAULT_CHART_WINDOW_STATE);
    expect(parseChartWindowState("?symbol=ETHUSD&interval=bad")).toEqual({ symbol: "ETHUSD", interval: "15m" });
    expect(parseChartWindowState("?symbol=ETHUSD&symbol=SOLUSD&interval=1h&interval=bad")).toEqual({
      symbol: "ETHUSD",
      interval: "1h",
    });
    expect(parseChartWindowState("?symbol=%45THUSD&interval=%31h")).toEqual({ symbol: "ETHUSD", interval: "1h" });
    expect(parseChartWindowState("?symbol=%E0%A4%A&interval=%")).toEqual(DEFAULT_CHART_WINDOW_STATE);
  });

  it("opens and focuses a new browser window with the encoded chart state", async () => {
    const focus = vi.fn();
    const childWindow = { closed: false, focus } as unknown as Window;
    const opener = vi.fn(() => childWindow);
    let onReady: (event: MessageEvent) => void = () => undefined;
    const readyChannelFactory: ChartWindowReadyChannelFactory = () => ({
      addEventListener: (_type, listener) => {
        onReady = listener;
      },
      removeEventListener: vi.fn(),
      close: vi.fn(),
    });

    const launch = openChartWindow(
      { symbol: "BTCUSD", interval: "5m" },
      opener,
      "https://chart.example/workspace?tenant=demo#dashboard",
      readyChannelFactory,
    );

    expect(launch?.childWindow).toBe(childWindow);
    expect(opener).toHaveBeenCalledWith(
      expect.stringContaining("https://chart.example/workspace?symbol=BTCUSD&interval=5m"),
      "_blank",
      expect.stringContaining("popup=yes"),
    );
    expect(opener).toHaveBeenCalledWith(
      expect.stringContaining("chartWindowLaunch="),
      "_blank",
      expect.stringContaining("noopener"),
    );
    expect(opener).toHaveBeenCalledWith(
      expect.anything(),
      "_blank",
      expect.stringContaining("noreferrer"),
    );
    onReady({ data: "chart-window-ready" } as MessageEvent);
    await expect(launch?.ready).resolves.toBe(true);
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it("reports a blocked popup when no child window is available", async () => {
    const opener = vi.fn(() => null);
    const launch = openChartWindow(
      { symbol: "BTCUSD", interval: "15m" },
      opener,
      "https://chart.example/",
      null,
    );

    expect(launch?.childWindow).toBeNull();
    await expect(launch?.ready).resolves.toBe(false);
  });

  it("returns the child window when focusing it fails", () => {
    const childWindow = {
      closed: false,
      focus: vi.fn(() => {
        throw new Error("focus denied");
      }),
    } as unknown as Window;

    expect(openChartWindow(
      { symbol: "BTCUSD", interval: "15m" },
      vi.fn(() => childWindow),
      "https://chart.example/",
      null,
    )?.childWindow).toBe(childWindow);
  });
});
