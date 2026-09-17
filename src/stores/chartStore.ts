import { create } from "zustand";
import type { Interval, Symbol } from "../types/market";

interface ChartState {
  symbol: Symbol;
  interval: Interval;
  setSymbol: (symbol: Symbol) => void;
  setInterval: (interval: Interval) => void;
}

export const useChartStore = create<ChartState>((set) => ({
  symbol: "BTCUSD",
  interval: "15m",
  setSymbol: (symbol) => set({ symbol }),
  setInterval: (interval) => set({ interval }),
}));
