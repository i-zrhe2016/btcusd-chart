import { INTERVALS, SYMBOLS, type Interval, type Symbol } from "../types/market";

export interface ChartWindowState {
  symbol: Symbol;
  interval: Interval;
}

export const DEFAULT_CHART_WINDOW_STATE: ChartWindowState = {
  symbol: "BTCUSD",
  interval: "15m",
};

const POPUP_FEATURES = "popup=yes,width=1440,height=960,resizable=yes,scrollbars=yes";

function isSymbol(value: string | null): value is Symbol {
  return value !== null && (SYMBOLS as readonly string[]).includes(value);
}

function isInterval(value: string | null): value is Interval {
  return value !== null && (INTERVALS as readonly string[]).includes(value);
}

export function parseChartWindowState(search: string): ChartWindowState {
  const params = new URLSearchParams(search);
  const symbol = params.get("symbol");
  const interval = params.get("interval");

  return {
    symbol: isSymbol(symbol) ? symbol : DEFAULT_CHART_WINDOW_STATE.symbol,
    interval: isInterval(interval) ? interval : DEFAULT_CHART_WINDOW_STATE.interval,
  };
}

export function createChartWindowUrl(state: ChartWindowState, currentUrl: string): string {
  const url = new URL(currentUrl);

  url.searchParams.set("symbol", state.symbol);
  url.searchParams.set("interval", state.interval);

  return url.toString();
}

export type ChartWindowOpener = (
  url?: string | URL,
  target?: string,
  features?: string,
) => Window | null;

export function openChartWindow(
  state: ChartWindowState,
  opener?: ChartWindowOpener,
  currentUrl?: string,
): Window | null {
  const browserOpener = opener ?? (typeof window === "undefined" ? null : window.open.bind(window));
  const browserUrl = currentUrl ?? (typeof window === "undefined" ? null : window.location.href);

  if (!browserOpener || !browserUrl) {
    return null;
  }

  const childWindow = browserOpener(createChartWindowUrl(state, browserUrl), "_blank", POPUP_FEATURES);

  if (childWindow) {
    try {
      if (!childWindow.closed) {
        childWindow.focus();
      }
    } catch {
      // A popup may close or reject focus before the click handler finishes.
    }
  }

  return childWindow;
}
