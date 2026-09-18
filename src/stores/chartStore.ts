import { create } from "zustand";
import type { Interval, Symbol } from "../types/market";
import { DEFAULT_CHART_WINDOW_STATE, parseChartWindowState } from "../windowing/chartWindow";

interface ChartState {
  symbol: Symbol;
  interval: Interval;
  setSymbol: (symbol: Symbol) => void;
  setInterval: (interval: Interval) => void;
}

const initialChartState = typeof window === "undefined"
  ? DEFAULT_CHART_WINDOW_STATE
  : parseChartWindowState(window.location.search);

export const useChartStore = create<ChartState>((set) => ({
  ...initialChartState,
  setSymbol: (symbol) => set({ symbol }),
  setInterval: (interval) => set({ interval }),
}));
