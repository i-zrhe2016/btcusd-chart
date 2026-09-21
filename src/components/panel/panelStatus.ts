import type { MarketDataErrorInfo, MarketDataStatus } from "../../market-data/types";

export function formatPrice(value: number) {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function statusLabel(status: MarketDataStatus) {
  switch (status) {
    case "loading":
      return "Loading";
    case "connecting":
      return "Connecting";
    case "live":
      return "Live";
    case "stale":
      return "Stale";
    case "disconnected":
      return "Offline";
    case "reconnecting":
      return "Reconnecting";
    case "error":
      return "Error";
    default:
      return "Idle";
  }
}

export function statusMessage(status: MarketDataStatus, error: MarketDataErrorInfo | null) {
  if (error) {
    return error.message;
  }

  switch (status) {
    case "loading":
      return "Loading Binance history";
    case "connecting":
      return "Opening the Binance live stream";
    case "live":
      return "Binance WebSocket updates are active";
    case "stale":
      return "No recent Binance kline update";
    case "disconnected":
      return "The Binance WebSocket is disconnected";
    case "reconnecting":
      return "Retrying the Binance WebSocket";
    case "error":
      return "Binance market data is unavailable";
    default:
      return "Waiting for Binance market data";
  }
}
