import { describe, expect, it, vi } from "vitest";
import {
  createChartWindowUrl,
  DEFAULT_CHART_WINDOW_STATE,
  openChartWindow,
  parseChartWindowState,
} from "./chartWindow";

describe("chart window state", () => {
  it("serializes the active chart while preserving the current route", () => {
    const url = createChartWindowUrl(
      { symbol: "ETHUSD", interval: "1h" },
      "https://chart.example/workspace?source=watchlist#private-state",
    );

    expect(url).toBe("https://chart.example/workspace?symbol=ETHUSD&interval=1h");
  });

  it("hydrates valid state and falls back independently for invalid parameters", () => {
    expect(parseChartWindowState("?symbol=SOLUSD&interval=4h")).toEqual({ symbol: "SOLUSD", interval: "4h" });
    expect(parseChartWindowState("?symbol=UNKNOWN&interval=bad")).toEqual(DEFAULT_CHART_WINDOW_STATE);
    expect(parseChartWindowState("?symbol=ETHUSD&interval=bad")).toEqual({ symbol: "ETHUSD", interval: "15m" });
  });

  it("opens and focuses a new browser window with the encoded chart state", () => {
    const focus = vi.fn();
    const childWindow = { closed: false, focus } as unknown as Window;
    const opener = vi.fn(() => childWindow);

    expect(openChartWindow({ symbol: "BTCUSD", interval: "5m" }, opener, "https://chart.example/")).toBe(childWindow);
    expect(opener).toHaveBeenCalledWith(
      "https://chart.example/?symbol=BTCUSD&interval=5m",
      "_blank",
      expect.stringContaining("popup=yes"),
    );
    expect(opener).toHaveBeenCalledWith(
      expect.anything(),
      "_blank",
      expect.stringContaining("noopener"),
    );
    expect(opener).toHaveBeenCalledWith(
      expect.anything(),
      "_blank",
      expect.stringContaining("noreferrer"),
    );
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it("returns null when the browser blocks the popup", () => {
    const opener = vi.fn(() => null);

    expect(openChartWindow({ symbol: "BTCUSD", interval: "15m" }, opener, "https://chart.example/")).toBeNull();
  });

  it("returns the child window when focusing it fails", () => {
    const childWindow = {
      closed: false,
      focus: vi.fn(() => {
        throw new Error("focus denied");
      }),
    } as unknown as Window;

    expect(openChartWindow({ symbol: "BTCUSD", interval: "15m" }, vi.fn(() => childWindow), "https://chart.example/")).toBe(childWindow);
  });
});
