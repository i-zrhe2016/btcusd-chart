import { create } from "zustand";
import type { Interval } from "../types/market";

interface ChartState {
  symbol: string;
  interval: Interval;
  setSymbol: (symbol: string) => void;
  setInterval: (interval: Interval) => void;
}

export const useChartStore = create<ChartState>((set) => ({
  symbol: "BTCUSD",
  interval: "15m",
  setSymbol: (symbol) => set({ symbol }),
  setInterval: (interval) => set({ interval }),
}));
