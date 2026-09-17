import { useCallback, useSyncExternalStore } from "react";
import { MarketDataHub } from "./MarketDataHub";
import { createMarketKey, type MarketRequest } from "./types";

export const defaultMarketDataHub = new MarketDataHub();

export function useMarketData(request: MarketRequest, hub = defaultMarketDataHub) {
  const key = createMarketKey(request);
  const subscribe = useCallback(
    (listener: () => void) => hub.subscribe(request, listener),
    [hub, key],
  );
  const getSnapshot = useCallback(() => hub.getSnapshot(request), [hub, key]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const retry = useCallback(() => hub.retry(request), [hub, key]);

  return { ...snapshot, retry };
}
