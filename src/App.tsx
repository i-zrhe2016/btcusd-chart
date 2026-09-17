import {
  Activity,
  BarChart3,
  Bell,
  ChevronDown,
  Clock3,
  Menu,
  Plus,
  Radio,
  Search,
  Settings2,
  Star,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import PriceChart from "./components/chart/PriceChart";
import { createFixtureCandles } from "./data/fixtureCandles";
import { useChartStore } from "./stores/chartStore";
import { INTERVALS, SYMBOLS, type WatchlistItem, type WatchlistQuote } from "./types/market";

const watchlist: WatchlistItem[] = [
  { symbol: "BTCUSD", venue: "Binance spot" },
  { symbol: "ETHUSD", venue: "Watch only" },
  { symbol: "SOLUSD", venue: "Watch only" },
  { symbol: "BNBUSD", venue: "Watch only" },
];

function formatPrice(value: number) {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatVolume(value: number) {
  if (value < 1_000) {
    return value.toLocaleString("en-US", { maximumFractionDigits: 1 });
  }

  return `${(value / 1_000).toFixed(1)}K`;
}

function formatSigned(value: number, suffix = "") {
  const sign = value >= 0 ? "+" : "-";
  return `${sign}${formatPrice(Math.abs(value))}${suffix}`;
}

export default function App() {
  const symbol = useChartStore((state) => state.symbol);
  const interval = useChartStore((state) => state.interval);
  const setSymbol = useChartStore((state) => state.setSymbol);
  const setInterval = useChartStore((state) => state.setInterval);
  const [watchlistQuery, setWatchlistQuery] = useState("");
  const selectedMarket = watchlist.find((item) => item.symbol === symbol) ?? watchlist[0];
  const candles = useMemo(() => createFixtureCandles(interval, symbol), [interval, symbol]);
  const watchlistQuotes = useMemo<WatchlistQuote[]>(() => watchlist.map((item) => {
    const itemCandles = item.symbol === symbol ? candles : createFixtureCandles(interval, item.symbol);
    const first = itemCandles[0];
    const last = itemCandles[itemCandles.length - 1];
    const changePercent = ((last.close - first.open) / first.open) * 100;

    return {
      ...item,
      price: formatPrice(last.close),
      change: formatSigned(changePercent, "%"),
      tone: changePercent >= 0 ? "up" : "down",
    };
  }), [candles, interval, symbol]);
  const visibleWatchlist = useMemo(() => {
    const query = watchlistQuery.trim().toUpperCase();

    if (!query) {
      return watchlistQuotes;
    }

    return watchlistQuotes.filter((item) => item.symbol.includes(query));
  }, [watchlistQuery, watchlistQuotes]);
  const stats = useMemo(() => {
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
          <span className="tape-value">Preview feed</span>
          <span className="tape-separator" aria-hidden="true" />
          <span className="tape-label">SESSION</span>
          <span className="tape-value">UTC / 24H</span>
        </div>

        <div className="topbar-actions">
          <button className="icon-button" type="button" title="Unavailable in preview" aria-label="Search markets" disabled>
            <Search size={17} />
          </button>
          <button className="icon-button" type="button" title="Unavailable in preview" aria-label="Notifications" disabled>
            <Bell size={17} />
          </button>
          <button className="profile-button" type="button" title="Unavailable in preview" aria-label="Open profile menu" disabled>
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
            <button className="icon-button subtle" type="button" title="Unavailable in preview" aria-label="Add market" disabled>
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
                    <span>{item.venue}</span>
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
            <span>Local preview symbols</span>
          </div>
        </aside>

        <main className="workspace">
          <div className="workspace-toolbar">
            <div className="instrument-heading">
              <div className="instrument-line">
                <BarChart3 size={18} aria-hidden="true" />
                <h1>{symbol}</h1>
                <span className="instrument-badge">
                  {selectedMarket.venue === "Binance spot" ? "Spot" : "Preview"}
                </span>
              </div>
              <span className="instrument-source">
                {selectedMarket.venue === "Binance spot" ? "Binance symbol mapping / local preview" : "Local fixture / watchlist preview"}
              </span>
            </div>
            <div className="toolbar-actions">
              <button className="tool-button" type="button" title="Unavailable in preview" aria-label="Chart settings" disabled>
                <Settings2 size={15} />
                <span>Chart</span>
              </button>
              <button className="icon-button subtle" type="button" title="Unavailable in preview" aria-label="More chart actions" disabled>
                <Menu size={17} />
              </button>
            </div>
          </div>

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
              <strong>{formatPrice(stats.last)}</strong>
              <span className={stats.change >= 0 ? "quote-up" : "quote-down"}>
                {formatSigned(stats.change)} / {formatSigned(stats.changePercent, "%")}
              </span>
            </div>
            <div className="quote-stat">
              <span>Session high</span>
              <strong>{formatPrice(stats.high)}</strong>
            </div>
            <div className="quote-stat">
              <span>Session low</span>
              <strong>{formatPrice(stats.low)}</strong>
            </div>
            <div className="quote-stat">
              <span>Volume</span>
              <strong>{formatVolume(stats.volume)}</strong>
            </div>
          </section>

          <section className="chart-surface" aria-label="Price chart workspace">
            <div className="chart-surface-header">
              <div className="chart-title-group">
                <span className="chart-title">{symbol} / USD</span>
                <span className="chart-interval">{interval} candles</span>
              </div>
              <div className="chart-header-tools">
                <span className="chart-state"><Clock3 size={13} /> Historical preview</span>
              </div>
            </div>
            <div className="chart-stage">
              <PriceChart candles={candles} symbol={symbol} viewKey={`${symbol}:${interval}`} />
            </div>
            <div className="chart-legend">
              <span><i className="legend-swatch up" /> Up candle</span>
              <span><i className="legend-swatch down" /> Down candle</span>
              <span><i className="legend-swatch volume" /> Volume</span>
              <span className="legend-spacer" />
              <span>Data source: Fixture</span>
            </div>
          </section>
        </main>
      </div>

      <footer className="statusbar">
        <div className="statusbar-left">
          <span className="status-live"><span className="status-dot" /> Preview mode</span>
          <span>Updates paused until Binance connection is enabled</span>
        </div>
        <div className="statusbar-right">
          <span>v0.1.0</span>
          <span>Web workspace</span>
        </div>
      </footer>
    </div>
  );
}
