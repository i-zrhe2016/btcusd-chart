import {
  BinanceMarketDataError,
  BinanceRestClient,
  buildBinanceKlineStreamUrl,
  createDefaultBinanceWebSocketFactory,
  parseBinanceKlineMessage,
  type BinanceHistoryClient,
  type BinanceKlineSocket,
  type BinanceWebSocketFactory,
} from "./binanceAdapter";
import {
  createMarketKey,
  type MarketCandleUpdate,
  type MarketDataErrorInfo,
  type MarketDataSnapshot,
  type MarketDataStatus,
  type MarketKey,
  type MarketRequest,
} from "./types";
import type { Candle } from "../types/market";

const DEFAULT_RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000];
const DEFAULT_STALE_AFTER_MS = 15_000;

type TimerHandle = ReturnType<typeof setTimeout>;
type TimeoutScheduler = (handler: () => void, timeout: number) => TimerHandle;
type TimeoutCanceller = (handle: TimerHandle) => void;
type SnapshotListener = () => void;
type UpdateListener = (update: MarketCandleUpdate) => void;

export interface MarketDataHubOptions {
  restClient?: BinanceHistoryClient;
  socketFactory?: BinanceWebSocketFactory;
  wsBaseUrl?: string;
  now?: () => number;
  setTimeout?: TimeoutScheduler;
  clearTimeout?: TimeoutCanceller;
  reconnectDelaysMs?: readonly number[];
  staleAfterMs?: number;
}

interface MarketDataEntry {
  key: MarketKey;
  request: MarketRequest;
  snapshot: MarketDataSnapshot;
  snapshotListeners: Map<SnapshotListener, number>;
  updateListeners: Map<UpdateListener, number>;
  active: boolean;
  historyReady: boolean;
  historyController: AbortController | null;
  socket: BinanceKlineSocket | null;
  socketOpen: boolean;
  reconnectTimer: TimerHandle | null;
  staleTimer: TimerHandle | null;
  reconnectAttempt: number;
  pendingUpdates: MarketCandleUpdate[];
}

export function upsertCandle(candles: readonly Candle[], nextCandle: Candle): Candle[] {
  const existingIndex = candles.findIndex((candle) => candle.time === nextCandle.time);

  if (existingIndex >= 0) {
    return [
      ...candles.slice(0, existingIndex),
      nextCandle,
      ...candles.slice(existingIndex + 1),
    ];
  }

  const insertionIndex = candles.findIndex((candle) => candle.time > nextCandle.time);

  if (insertionIndex < 0) {
    return [...candles, nextCandle];
  }

  return [
    ...candles.slice(0, insertionIndex),
    nextCandle,
    ...candles.slice(insertionIndex),
  ];
}

export class MarketDataHub {
  private readonly entries = new Map<MarketKey, MarketDataEntry>();
  private readonly restClient: BinanceHistoryClient;
  private readonly socketFactory: BinanceWebSocketFactory;
  private readonly wsBaseUrl: string | undefined;
  private readonly now: () => number;
  private readonly scheduleTimeout: TimeoutScheduler;
  private readonly cancelTimeout: TimeoutCanceller;
  private readonly reconnectDelaysMs: readonly number[];
  private readonly staleAfterMs: number;

  constructor(options: MarketDataHubOptions = {}) {
    this.restClient = options.restClient ?? new BinanceRestClient();
    this.socketFactory = options.socketFactory ?? createDefaultBinanceWebSocketFactory();
    this.wsBaseUrl = options.wsBaseUrl;
    this.now = options.now ?? Date.now;
    this.scheduleTimeout = options.setTimeout ?? ((handler, timeout) => globalThis.setTimeout(handler, timeout));
    this.cancelTimeout = options.clearTimeout ?? ((handle) => globalThis.clearTimeout(handle));
    this.reconnectDelaysMs = options.reconnectDelaysMs?.length
      ? [...options.reconnectDelaysMs]
      : DEFAULT_RECONNECT_DELAYS_MS;
    this.staleAfterMs = options.staleAfterMs && options.staleAfterMs > 0
      ? options.staleAfterMs
      : DEFAULT_STALE_AFTER_MS;
  }

  getSnapshot(request: MarketRequest): MarketDataSnapshot {
    return this.ensureEntry(request).snapshot;
  }

  subscribe(request: MarketRequest, listener: SnapshotListener): () => void {
    const entry = this.ensureEntry(request);
    this.addListener(entry.snapshotListeners, listener);
    this.start(entry);

    return () => {
      this.removeListener(entry.snapshotListeners, listener);
      this.releaseIfUnused(entry);
    };
  }

  subscribeUpdates(request: MarketRequest, listener: UpdateListener): () => void {
    const entry = this.ensureEntry(request);
    this.addListener(entry.updateListeners, listener);
    this.start(entry);

    return () => {
      this.removeListener(entry.updateListeners, listener);
      this.releaseIfUnused(entry);
    };
  }

  retry(request: MarketRequest): void {
    const entry = this.ensureEntry(request);

    if (!this.hasSubscribers(entry)) {
      return;
    }

    this.stop(entry);
    this.start(entry);
  }

  getSubscriberCount(request: MarketRequest): number {
    const entry = this.entries.get(createMarketKey(request));

    if (!entry) {
      return 0;
    }

    return this.listenerCount(entry.snapshotListeners) + this.listenerCount(entry.updateListeners);
  }

  private ensureEntry(request: MarketRequest): MarketDataEntry {
    const key = createMarketKey(request);
    const existing = this.entries.get(key);

    if (existing) {
      return existing;
    }

    const entry: MarketDataEntry = {
      key,
      request,
      snapshot: {
        key,
        request,
        candles: [],
        status: "idle",
        error: null,
        lastUpdateAt: null,
      },
      snapshotListeners: new Map(),
      updateListeners: new Map(),
      active: false,
      historyReady: false,
      historyController: null,
      socket: null,
      socketOpen: false,
      reconnectTimer: null,
      staleTimer: null,
      reconnectAttempt: 0,
      pendingUpdates: [],
    };

    this.entries.set(key, entry);
    return entry;
  }

  private start(entry: MarketDataEntry): void {
    if (entry.active) {
      return;
    }

    entry.active = true;
    entry.historyReady = false;
    entry.pendingUpdates = [];
    entry.reconnectAttempt = 0;
    this.publish(entry, {
      candles: [],
      status: "loading",
      error: null,
      lastUpdateAt: null,
    });

    const controller = new AbortController();
    entry.historyController = controller;
    this.connect(entry);
    void this.loadHistory(entry, controller);
  }

  private async loadHistory(entry: MarketDataEntry, controller: AbortController): Promise<void> {
    try {
      const candles = await this.restClient.fetchCandles(entry.request, undefined, controller.signal);

      if (!this.isActive(entry, controller)) {
        return;
      }

      if (candles.length === 0) {
        throw new BinanceMarketDataError("payload", "Binance returned no historical candles");
      }

      const pendingUpdates = entry.pendingUpdates;
      let mergedCandles = candles;

      for (const update of pendingUpdates) {
        mergedCandles = upsertCandle(mergedCandles, update.candle);
      }

      entry.pendingUpdates = [];
      entry.historyReady = true;
      const status = entry.socketOpen
        ? "live"
        : entry.socket
          ? "connecting"
          : "disconnected";
      this.publish(entry, {
        candles: mergedCandles,
        status,
        error: status === "live" ? null : entry.snapshot.error,
        lastUpdateAt: pendingUpdates.length > 0 ? this.now() : entry.snapshot.lastUpdateAt,
      });

      if (status === "live") {
        this.scheduleStale(entry);
      }
    } catch (error) {
      if (!this.isActive(entry, controller) || controller.signal.aborted) {
        return;
      }

      const errorInfo = this.toErrorInfo(error, "network");
      this.stop(entry);
      this.publish(entry, {
        status: "error",
        error: errorInfo,
      });
    }
  }

  private connect(entry: MarketDataEntry): void {
    if (!entry.active || entry.socket) {
      return;
    }

    const url = buildBinanceKlineStreamUrl(entry.request, this.wsBaseUrl);
    let socket: BinanceKlineSocket;

    try {
      socket = this.socketFactory(url);
    } catch (error) {
      this.publish(entry, {
        status: "disconnected",
        error: this.toErrorInfo(error, "websocket"),
      });
      this.scheduleReconnect(entry);
      return;
    }

    entry.socket = socket;
    entry.socketOpen = false;
    this.publish(entry, {
      status: entry.historyReady
        ? entry.reconnectAttempt > 0 ? "reconnecting" : "connecting"
        : "loading",
      error: null,
    });

    socket.onopen = () => {
      if (!this.isCurrentSocket(entry, socket)) {
        return;
      }

      entry.socketOpen = true;
      entry.reconnectAttempt = 0;
      this.publish(entry, {
        status: entry.historyReady ? "live" : "loading",
        error: null,
        lastUpdateAt: this.now(),
      });

      if (entry.historyReady) {
        this.scheduleStale(entry);
      }
    };

    socket.onmessage = (event) => {
      if (!this.isCurrentSocket(entry, socket)) {
        return;
      }

      let update: MarketCandleUpdate;

      try {
        update = parseBinanceKlineMessage(event.data);
      } catch (error) {
        this.publish(entry, {
          status: "error",
          error: this.toErrorInfo(error, "payload"),
        });
        return;
      }

      if (createMarketKey(update.request) !== entry.key) {
        return;
      }

      if (!entry.historyReady) {
        entry.pendingUpdates.push(update);
        return;
      }

      this.applyUpdate(entry, update);
    };

    socket.onerror = () => {
      if (!this.isCurrentSocket(entry, socket)) {
        return;
      }

      entry.socketOpen = false;
      this.publish(entry, {
        status: "disconnected",
        error: {
          kind: "websocket",
          message: "Binance WebSocket connection failed",
        },
      });
    };

    socket.onclose = () => {
      if (!this.isCurrentSocket(entry, socket)) {
        return;
      }

      entry.socketOpen = false;
      entry.socket = null;
      this.clearStaleTimer(entry);
      this.scheduleReconnect(entry);
    };
  }

  private applyUpdate(entry: MarketDataEntry, update: MarketCandleUpdate): void {
    const candles = upsertCandle(entry.snapshot.candles, update.candle);
    this.publish(entry, {
      candles,
      status: "live",
      error: null,
      lastUpdateAt: this.now(),
    });

    for (const listener of entry.updateListeners.keys()) {
      listener(update);
    }

    this.scheduleStale(entry);
  }

  private scheduleReconnect(entry: MarketDataEntry): void {
    if (!entry.active || entry.reconnectTimer !== null) {
      return;
    }

    const attempt = Math.min(entry.reconnectAttempt, this.reconnectDelaysMs.length - 1);
    const delay = this.reconnectDelaysMs[Math.max(0, attempt)];
    entry.reconnectAttempt += 1;
    this.publish(entry, {
      status: "disconnected",
      error: entry.snapshot.error ?? {
        kind: "websocket",
        message: "Binance WebSocket disconnected",
      },
    });
    entry.reconnectTimer = this.scheduleTimeout(() => {
      entry.reconnectTimer = null;

      if (!entry.active) {
        return;
      }

      this.publish(entry, { status: "reconnecting" });
      this.connect(entry);
    }, delay);
  }

  private scheduleStale(entry: MarketDataEntry): void {
    this.clearStaleTimer(entry);

    if (!entry.active || entry.snapshot.status !== "live") {
      return;
    }

    const lastUpdateAt = entry.snapshot.lastUpdateAt ?? this.now();
    const elapsed = Math.max(0, this.now() - lastUpdateAt);
    const delay = Math.max(1, this.staleAfterMs - elapsed);

    entry.staleTimer = this.scheduleTimeout(() => {
      entry.staleTimer = null;

      if (!entry.active || entry.snapshot.status !== "live") {
        return;
      }

      const latestUpdateAt = entry.snapshot.lastUpdateAt ?? this.now();

      if (this.now() - latestUpdateAt >= this.staleAfterMs) {
        this.publish(entry, { status: "stale" });
        return;
      }

      this.scheduleStale(entry);
    }, delay);
  }

  private stop(entry: MarketDataEntry): void {
    entry.active = false;
    entry.historyReady = false;
    entry.historyController?.abort();
    entry.historyController = null;
    entry.pendingUpdates = [];
    this.clearReconnectTimer(entry);
    this.clearStaleTimer(entry);

    const socket = entry.socket;
    entry.socket = null;
    entry.socketOpen = false;
    socket?.close();
  }

  private releaseIfUnused(entry: MarketDataEntry): void {
    if (!this.hasSubscribers(entry)) {
      this.stop(entry);
    }
  }

  private clearReconnectTimer(entry: MarketDataEntry): void {
    if (entry.reconnectTimer === null) {
      return;
    }

    this.cancelTimeout(entry.reconnectTimer);
    entry.reconnectTimer = null;
  }

  private clearStaleTimer(entry: MarketDataEntry): void {
    if (entry.staleTimer === null) {
      return;
    }

    this.cancelTimeout(entry.staleTimer);
    entry.staleTimer = null;
  }

  private isActive(entry: MarketDataEntry, controller: AbortController): boolean {
    return entry.active && entry.historyController === controller;
  }

  private isCurrentSocket(entry: MarketDataEntry, socket: BinanceKlineSocket): boolean {
    return entry.active && entry.socket === socket;
  }

  private publish(
    entry: MarketDataEntry,
    patch: Partial<Pick<MarketDataSnapshot, "candles" | "status" | "error" | "lastUpdateAt">>,
  ): void {
    entry.snapshot = { ...entry.snapshot, ...patch };

    for (const listener of entry.snapshotListeners.keys()) {
      listener();
    }
  }

  private toErrorInfo(error: unknown, fallbackKind: "network" | "payload" | "websocket"): MarketDataErrorInfo {
    if (error instanceof BinanceMarketDataError) {
      return {
        kind: error.kind,
        message: error.message,
        ...(error.status === undefined ? {} : { status: error.status }),
      };
    }

    return {
      kind: fallbackKind,
      message: error instanceof Error ? error.message : "Binance market data request failed",
    };
  }

  private addListener<T>(listeners: Map<T, number>, listener: T): void {
    listeners.set(listener, (listeners.get(listener) ?? 0) + 1);
  }

  private removeListener<T>(listeners: Map<T, number>, listener: T): void {
    const count = listeners.get(listener);

    if (!count) {
      return;
    }

    if (count === 1) {
      listeners.delete(listener);
    } else {
      listeners.set(listener, count - 1);
    }
  }

  private listenerCount<T>(listeners: Map<T, number>): number {
    let count = 0;

    for (const listenerCount of listeners.values()) {
      count += listenerCount;
    }

    return count;
  }

  private hasSubscribers(entry: MarketDataEntry): boolean {
    return this.listenerCount(entry.snapshotListeners) + this.listenerCount(entry.updateListeners) > 0;
  }
}
