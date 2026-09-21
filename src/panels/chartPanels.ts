import type { Interval, Symbol } from "../types/market";

/** The terminal shows one market; symbol switching is not part of the UI. */
export const TERMINAL_SYMBOL: Symbol = "BTCUSD";

/** The four panels of the 2x2 terminal grid, in reading order. */
export const DEFAULT_PANEL_INTERVALS: readonly Interval[] = ["15m", "1h", "4h", "1d"];

export interface ChartPanelConfig {
  id: string;
  symbol: Symbol;
  interval: Interval;
}

/**
 * Panel ids stay stable while the layout changes, so a panel keeps its chart
 * instance and its timeframe when the grid re-renders.
 */
export function createDefaultPanels(symbol: Symbol = TERMINAL_SYMBOL): ChartPanelConfig[] {
  return DEFAULT_PANEL_INTERVALS.map((interval, index) => ({
    id: `panel-${index + 1}`,
    symbol,
    interval,
  }));
}

export function setPanelInterval(
  panels: readonly ChartPanelConfig[],
  panelId: string,
  interval: Interval,
): ChartPanelConfig[] {
  return panels.map((panel) => (panel.id === panelId ? { ...panel, interval } : panel));
}
