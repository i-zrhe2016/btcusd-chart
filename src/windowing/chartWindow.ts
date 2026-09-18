import { INTERVALS, SYMBOLS, type Interval, type Symbol } from "../types/market";

export interface ChartWindowState {
  symbol: Symbol;
  interval: Interval;
}

export const DEFAULT_CHART_WINDOW_STATE: ChartWindowState = {
  symbol: "BTCUSD",
  interval: "15m",
};

const POPUP_FEATURES = "popup=yes,width=1440,height=960,resizable=yes,scrollbars=yes,noopener,noreferrer";
const CHART_WINDOW_LAUNCH_PARAM = "chartWindowLaunch";
const CHART_WINDOW_CHANNEL_PREFIX = "btcusd-chart-window:";
const CHART_WINDOW_READY_TIMEOUT_MS = 2_000;

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

export function createChartWindowUrl(state: ChartWindowState, currentUrl: string, launchId?: string): string {
  const sourceUrl = new URL(currentUrl);
  const url = new URL(sourceUrl.origin + sourceUrl.pathname);

  url.searchParams.set("symbol", state.symbol);
  url.searchParams.set("interval", state.interval);

  if (launchId) {
    url.searchParams.set(CHART_WINDOW_LAUNCH_PARAM, launchId);
  }

  return url.toString();
}

export function getChartWindowLaunchId(search: string): string | null {
  return new URLSearchParams(search).get(CHART_WINDOW_LAUNCH_PARAM);
}

export function createChartWindowChannelName(launchId: string): string {
  return `${CHART_WINDOW_CHANNEL_PREFIX}${launchId}`;
}

export type ChartWindowOpener = (
  url?: string | URL,
  target?: string,
  features?: string,
) => Window | null;

export interface ChartWindowReadyChannel {
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  close(): void;
}

export type ChartWindowReadyChannelFactory = (name: string) => ChartWindowReadyChannel;

export interface ChartWindowLaunch {
  childWindow: Window | null;
  ready: Promise<boolean>;
}

function createLaunchId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getReadyChannelFactory(): ChartWindowReadyChannelFactory | null {
  if (typeof window === "undefined" || typeof window.BroadcastChannel !== "function") {
    return null;
  }

  return (name) => new window.BroadcastChannel(name);
}

function waitForChartWindowReady(
  channel: ChartWindowReadyChannel | null,
  childWindow: Window | null,
): Promise<boolean> {
  if (!channel || typeof window === "undefined") {
    return Promise.resolve(childWindow !== null);
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (ready: boolean) => {
      if (settled) {
        return;
      }

      settled = true;
      window.clearTimeout(timeout);
      channel.removeEventListener("message", onMessage);
      channel.close();
      resolve(ready);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.data === "chart-window-ready") {
        finish(true);
      }
    };
    const timeout = window.setTimeout(() => finish(false), CHART_WINDOW_READY_TIMEOUT_MS);

    channel.addEventListener("message", onMessage);
  });
}

export function openChartWindow(
  state: ChartWindowState,
  opener?: ChartWindowOpener,
  currentUrl?: string,
  readyChannelFactory: ChartWindowReadyChannelFactory | null = getReadyChannelFactory(),
): ChartWindowLaunch | null {
  const browserOpener = opener ?? (typeof window === "undefined" ? null : window.open.bind(window));
  const browserUrl = currentUrl ?? (typeof window === "undefined" ? null : window.location.href);

  if (!browserOpener || !browserUrl) {
    return null;
  }

  const launchId = createLaunchId();
  const channel = readyChannelFactory?.(createChartWindowChannelName(launchId)) ?? null;
  let childWindow: Window | null = null;

  try {
    childWindow = browserOpener(
      createChartWindowUrl(state, browserUrl, launchId),
      "_blank",
      POPUP_FEATURES,
    );
  } catch {
    channel?.close();
    return null;
  }

  if (childWindow) {
    try {
      if (!childWindow.closed) {
        childWindow.focus();
      }
    } catch {
      // A popup may close or reject focus before the click handler finishes.
    }
  }

  return {
    childWindow,
    ready: waitForChartWindowReady(channel, childWindow),
  };
}
