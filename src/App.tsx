import {
  Activity,
  BarChart3,
  Bell,
  ChevronDown,
  Clock3,
  ExternalLink,
  LoaderCircle,
  Menu,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Settings2,
  Star,
  WifiOff,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import PriceChart from "./components/chart/PriceChart";
import { useMarketData } from "./market-data/useMarketData";
import { toBinanceSymbol } from "./market-data/binanceAdapter";
import { useChartStore } from "./stores/chartStore";
import { INTERVALS, SYMBOLS, type WatchlistItem, type WatchlistQuote } from "./types/market";
import type { MarketDataErrorInfo, MarketDataStatus } from "./market-data/types";
import { openChartWindow } from "./windowing/chartWindow";

const watchlist: WatchlistItem[] = [
  { symbol: "BTCUSD", venue: "Binance spot" },
  { symbol: "ETHUSD", venue: "Binance spot" },
  { symbol: "SOLUSD", venue: "Binance spot" },
  { symbol: "BNBUSD", venue: "Binance spot" },
];

function formatPrice(value: number) {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatVolume(value: number) {
  if (value >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(1)}B`;
  }

  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }

  if (value < 1_000) {
    return value.toLocaleString("en-US", { maximumFractionDigits: 1 });
  }

  return `${(value / 1_000).toFixed(1)}K`;
}

function formatSigned(value: number, suffix = "") {
  const sign = value >= 0 ? "+" : "-";
  return `${sign}${formatPrice(Math.abs(value))}${suffix}`;
}

function statusLabel(status: MarketDataStatus) {
  switch (status) {
    case "loading":
      return "Loading history";
    case "connecting":
      return "Connecting";
    case "live":
      return "Live feed";
    case "stale":
      return "Stale feed";
    case "disconnected":
      return "Disconnected";
    case "reconnecting":
      return "Reconnecting";
    case "error":
      return "Data error";
    default:
      return "Idle";
  }
}

function statusMessage(status: MarketDataStatus, error: MarketDataErrorInfo | null) {
  if (error) {
    return error.message;
  }

  switch (status) {
    case "loading":
      return "Loading Binance historical candles...";
    case "connecting":
      return "History loaded; opening the Binance live stream...";
    case "live":
      return "Binance WebSocket updates are active.";
    case "stale":
      return "No Binance kline update has arrived recently.";
    case "disconnected":
      return "The Binance WebSocket is disconnected.";
    case "reconnecting":
      return "Retrying the Binance WebSocket connection...";
    case "error":
      return "Binance market data is unavailable.";
    default:
      return "Waiting for Binance market data.";
  }
}

export default function App() {
  const symbol = useChartStore((state) => state.symbol);
  const interval = useChartStore((state) => state.interval);
  const setSymbol = useChartStore((state) => state.setSymbol);
  const setInterval = useChartStore((state) => state.setInterval);
  const [watchlistQuery, setWatchlistQuery] = useState("");
  const [windowMessage, setWindowMessage] = useState<string | null>(null);
  const market = useMarketData({ symbol, interval });
  const candles = market.candles;
  const watchlistQuotes = useMemo<WatchlistQuote[]>(() => watchlist.map((item) => {
    const itemCandles = item.symbol === symbol ? candles : [];
    const first = itemCandles[0];
    const last = itemCandles[itemCandles.length - 1];

    if (!first || !last) {
      return {
        ...item,
        venue: item.symbol === symbol ? statusLabel(market.status) : "Not loaded",
        price: "--",
        change: "--",
        tone: "muted",
      };
    }

    const changePercent = ((last.close - first.open) / first.open) * 100;

    return {
      ...item,
      venue: "Binance spot",
      price: formatPrice(last.close),
      change: formatSigned(changePercent, "%"),
      tone: changePercent >= 0 ? "up" : "down",
    };
  }), [candles, market.status, symbol]);
  const visibleWatchlist = useMemo(() => {
    const query = watchlistQuery.trim().toUpperCase();

    if (!query) {
      return watchlistQuotes;
    }

    return watchlistQuotes.filter((item) => item.symbol.includes(query));
  }, [watchlistQuery, watchlistQuotes]);
  const stats = useMemo(() => {
    if (candles.length === 0) {
      return null;
    }

    const first = candles[0];
    const last = candles[candles.length - 1];
    const high = Math.max(...candles.map((candle) => candle.high));
    const low = Math.min(...candles.map((candle) => candle.low));
    const change = last.close - first.open;
    const changePercent = (change / first.open) * 100;

    return {
      last: last.close,
      high,
      low,
      volume: candles.reduce((total, candle) => total + candle.volume, 0),
      change,
      changePercent,
    };
  }, [candles]);
  const currentStatusLabel = statusLabel(market.status);
  const currentStatusMessage = statusMessage(market.status, market.error);
  const showChartMessage = !stats || market.status === "error";

  const handleOpenChartWindow = () => {
    const childWindow = openChartWindow({ symbol, interval });

    if (!childWindow) {
      setWindowMessage("The chart window was blocked. Allow pop-ups and try again.");
      return;
    }

    setWindowMessage(null);
  };

  useEffect(() => {
    document.title = `${symbol} Chart`;
  }, [symbol]);

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      const target = event.target;

      if (
        event.key !== "/" ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        (target instanceof HTMLElement && target.matches("input, textarea, select, [contenteditable=\"true\"]"))
      ) {
        return;
      }

      const watchlistPanel = document.querySelector<HTMLElement>(".watchlist-panel");

      if (!watchlistPanel || getComputedStyle(watchlistPanel).display === "none") {
        return;
      }

      event.preventDefault();
      document.getElementById("watchlist-search")?.focus();
    };

    window.addEventListener("keydown", focusSearch);

    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">
            <Activity size={17} strokeWidth={2.4} />
          </div>
          <div>
            <div className="brand-name">Market Lab</div>
            <div className="brand-subtitle">{symbol} workspace</div>
          </div>
        </div>

        <div className="topbar-tape" aria-label="Market snapshot">
          <span className="tape-label">MARKET STATUS</span>
          <span className="status-dot" aria-hidden="true" />
          <span className="tape-value">{currentStatusLabel}</span>
          <span className="tape-separator" aria-hidden="true" />
          <span className="tape-label">SESSION</span>
          <span className="tape-value">UTC / 24H</span>
        </div>

        <div className="topbar-actions">
          <button className="icon-button" type="button" title="Not available yet" aria-label="Search markets" disabled>
            <Search size={17} />
          </button>
          <button className="icon-button" type="button" title="Not available yet" aria-label="Notifications" disabled>
            <Bell size={17} />
          </button>
          <button className="profile-button" type="button" title="Not available yet" aria-label="Open profile menu" disabled>
            <span className="profile-avatar">ML</span>
            <ChevronDown size={14} />
          </button>
        </div>
      </header>

      <div className="app-layout">
        <aside className="watchlist-panel" aria-label="Watchlist">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Markets</span>
              <h2>Watchlist</h2>
            </div>
            <button className="icon-button subtle" type="button" title="Not available yet" aria-label="Add market" disabled>
              <Plus size={16} />
            </button>
          </div>
          <label className="search-field" htmlFor="watchlist-search">
            <Search size={14} aria-hidden="true" />
            <input
              id="watchlist-search"
              type="search"
              placeholder="Find symbol"
              aria-label="Find symbol"
              value={watchlistQuery}
              onChange={(event) => setWatchlistQuery(event.target.value)}
            />
            <span className="key-hint">/</span>
          </label>
          <div className="watchlist-columns" aria-hidden="true">
            <span>Symbol</span>
            <span>Last</span>
          </div>
          <div className="watchlist-items">
            {visibleWatchlist.map((item) => (
              <button
                className={`watchlist-row ${item.symbol === symbol ? "active" : ""}`}
                type="button"
                aria-pressed={item.symbol === symbol}
                key={item.symbol}
                onClick={() => setSymbol(item.symbol)}
              >
                <div className="watchlist-symbol">
                  <Star size={13} fill={item.symbol === symbol ? "currentColor" : "none"} />
                  <div>
                    <strong>{item.symbol}</strong>
                    <span>{item.symbol === symbol ? item.venue : "Not loaded"}</span>
                  </div>
                </div>
                <div className="watchlist-quote">
                  <strong>{item.price}</strong>
                  <span className={`tone-${item.tone}`}>{item.change}</span>
                </div>
              </button>
            ))}
            {visibleWatchlist.length === 0 && <div className="watchlist-empty">No local symbols</div>}
          </div>
          <div className="watchlist-footer">
            <Radio size={14} />
            <span>Binance public market data</span>
          </div>
        </aside>

        <main className="workspace">
          <div className="workspace-toolbar">
            <div className="instrument-heading">
              <div className="instrument-line">
                <BarChart3 size={18} aria-hidden="true" />
                <h1>{symbol}</h1>
                <span className="instrument-badge">
                  Spot
                </span>
              </div>
              <span className="instrument-source">
                Binance spot / {toBinanceSymbol(symbol)} public market data
              </span>
            </div>
            <div className="toolbar-actions">
              <button className="tool-button" type="button" title="Not available yet" aria-label="Chart settings" disabled>
                <Settings2 size={15} />
                <span>Chart</span>
              </button>
              <button
                className="tool-button"
                type="button"
                title="Open chart in new window"
                aria-label="Open chart in new window"
                onClick={handleOpenChartWindow}
              >
                <ExternalLink size={15} />
                <span>New window</span>
              </button>
              <button className="icon-button subtle" type="button" title="Not available yet" aria-label="More chart actions" disabled>
                <Menu size={17} />
              </button>
            </div>
          </div>

          {windowMessage && (
            <div className="window-launch-status" role="status" aria-live="polite">
              <span>{windowMessage}</span>
              <button type="button" onClick={handleOpenChartWindow} aria-label="Retry opening chart window">
                <RefreshCw size={13} aria-hidden="true" />
                <span>Retry</span>
              </button>
            </div>
          )}

          <div className="interval-row">
            <div className="interval-controls">
              <div className="interval-tabs" role="group" aria-label="Chart interval">
                {INTERVALS.map((option) => (
                  <button
                    className={`interval-tab ${option === interval ? "active" : ""}`}
                    type="button"
                    aria-pressed={option === interval}
                    key={option}
                    onClick={() => setInterval(option)}
                  >
                    {option}
                  </button>
                ))}
              </div>
              <label className="mobile-symbol-select">
                <span className="sr-only">Select market</span>
                <select
                  value={symbol}
                  aria-label="Select market"
                  onChange={(event) => {
                    const nextSymbol = SYMBOLS.find((option) => option === event.target.value);

                    if (nextSymbol) {
                      setSymbol(nextSymbol);
                    }
                  }}
                >
                  {watchlist.map((item) => (
                    <option value={item.symbol} key={item.symbol}>
                      {item.symbol}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="chart-mode">
              <span className="mode-indicator" />
              Candles
              <ChevronDown size={13} />
            </div>
          </div>

          <section className="quote-strip" aria-label={`${symbol} quote summary`}>
            <div className="quote-primary">
              <span className="quote-label">Last price</span>
              <strong>{stats ? formatPrice(stats.last) : "--"}</strong>
              <span className={stats ? (stats.change >= 0 ? "quote-up" : "quote-down") : "quote-muted"}>
                {stats ? `${formatSigned(stats.change)} / ${formatSigned(stats.changePercent, "%")}` : currentStatusLabel}
              </span>
            </div>
            <div className="quote-stat">
              <span>Session high</span>
              <strong>{stats ? formatPrice(stats.high) : "--"}</strong>
            </div>
            <div className="quote-stat">
              <span>Session low</span>
              <strong>{stats ? formatPrice(stats.low) : "--"}</strong>
            </div>
            <div className="quote-stat">
              <span>Volume</span>
              <strong>{stats ? formatVolume(stats.volume) : "--"}</strong>
            </div>
          </section>

          <section className="chart-surface" aria-label="Price chart workspace">
            <div className="chart-surface-header">
              <div className="chart-title-group">
                <span className="chart-title">{symbol} / USD</span>
                <span className="chart-interval">{interval} candles</span>
              </div>
              <div className="chart-header-tools">
                <span className={`chart-state status-${market.status}`} aria-live="polite">
                  {market.status === "live" ? <Radio size={13} /> : <Clock3 size={13} />}
                  {currentStatusLabel}
                </span>
              </div>
            </div>
            <div className="chart-stage">
              <PriceChart candles={candles} symbol={symbol} viewKey={`${symbol}:${interval}`} />
              {showChartMessage && (
                <div className={`chart-message status-${market.status}`} role={market.status === "error" ? "alert" : "status"} aria-live="polite">
                  <div className="chart-message-icon">
                    {market.status === "error" ? <WifiOff size={18} /> : <LoaderCircle className="loading-icon" size={18} />}
                  </div>
                  <strong>{currentStatusLabel}</strong>
                  <span>{currentStatusMessage}</span>
                  {market.status === "error" && (
                    <button className="retry-button" type="button" onClick={market.retry}>
                      <RefreshCw size={14} />
                      Retry connection
                    </button>
                  )}
                </div>
              )}
            </div>
            <div className="chart-legend">
              <span><i className="legend-swatch up" /> Up candle</span>
              <span><i className="legend-swatch down" /> Down candle</span>
              <span><i className="legend-swatch volume" /> Volume</span>
              <span className="legend-spacer" />
              <span>Data source: Binance {toBinanceSymbol(symbol)}</span>
            </div>
          </section>
        </main>
      </div>

      <footer className="statusbar">
        <div className="statusbar-left">
          <span className={`status-live status-${market.status}`}><span className="status-dot" /> {currentStatusLabel}</span>
          <span>{currentStatusMessage}</span>
        </div>
        <div className="statusbar-right">
          <span>v0.1.0</span>
          <span>Web workspace</span>
        </div>
      </footer>
    </div>
  );
}
