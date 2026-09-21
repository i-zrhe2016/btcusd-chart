import type { Ref } from "react";
import PriceChart from "../chart/PriceChart";
import PanelStatusOverlay from "./PanelStatusOverlay";
import { useMarketData } from "../../market-data/useMarketData";
import { INTERVALS, type Interval, type Symbol } from "../../types/market";
import { formatPrice, statusLabel } from "./panelStatus";

export interface ChartPanelProps {
  panelId: string;
  symbol: Symbol;
  interval: Interval;
  onIntervalChange: (interval: Interval) => void;
  onExpand: () => void;
  ref?: Ref<HTMLElement>;
}

/**
 * One chart panel. The market is fixed to the panel's symbol and each panel owns
 * its timeframe, so four panels on four timeframes request four distinct market
 * keys and never share a subscription by accident.
 */
export default function ChartPanel({
  panelId,
  symbol,
  interval,
  onIntervalChange,
  onExpand,
  ref,
}: ChartPanelProps) {
  const market = useMarketData({ symbol, interval });
  const latestCandle = market.candles[market.candles.length - 1];
  const label = statusLabel(market.status);

  return (
    <section
      className="chart-panel"
      data-panel-id={panelId}
      ref={ref}
      tabIndex={-1}
      aria-label={`${symbol} ${interval} panel`}
    >
      <header className="panel-header">
        <span className="panel-symbol">{symbol}</span>
        <span className="panel-last">{latestCandle ? formatPrice(latestCandle.close) : "--"}</span>
        <div className="panel-timeframes" role="group" aria-label={`${symbol} timeframe`}>
          {INTERVALS.map((option) => (
            <button
              className={`panel-timeframe${option === interval ? " active" : ""}`}
              type="button"
              key={option}
              aria-pressed={option === interval}
              onClick={() => onIntervalChange(option)}
            >
              {option}
            </button>
          ))}
        </div>
        <span className={`panel-status status-${market.status}`} aria-live="polite">
          <span className="status-dot" aria-hidden="true" />
          {label}
        </span>
      </header>
      <div className="panel-body">
        <PriceChart
          candles={market.candles}
          symbol={symbol}
          viewKey={`${panelId}:${symbol}:${interval}`}
          onExpand={onExpand}
        />
        <PanelStatusOverlay
          status={market.status}
          error={market.error}
          hasCandles={market.candles.length > 0}
          onRetry={market.retry}
        />
      </div>
    </section>
  );
}
